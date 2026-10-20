"""Low-volume official metadata collection. No video or image downloads."""
from __future__ import annotations

import argparse
import copy
from datetime import datetime, timedelta, timezone
import json
import os
from pathlib import Path
import re
import sys
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
JST = timezone(timedelta(hours=9))
SCHEDULE_URL = "https://site.weathernews.jp/site/live/json/timetable.json"
VIDEOS_URL = "https://site.weathernews.jp/site/live/json/list.json"
VIDEO_ID = re.compile(r"^[A-Za-z0-9_-]{11}$")
HOUR = re.compile(r"^(?:[01]\d|2[0-3]):[0-5]\d$")


class SourceError(Exception):
    """Safe, public error code. Never include request URLs or API keys."""


def stamp(now: datetime) -> str:
    if now.tzinfo is None:
        raise ValueError("timezone required")
    return now.astimezone(JST).isoformat(timespec="seconds")


def read_json(path: Path, default=None):
    if not path.exists():
        return copy.deepcopy(default)
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, value) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    content = json.dumps(value, ensure_ascii=False, indent=2) + "\n"
    if path.exists() and path.read_text(encoding="utf-8") == content:
        return
    temp = path.with_suffix(path.suffix + ".tmp")
    temp.write_text(content, encoding="utf-8")
    temp.replace(path)


def fetch_json(url: str, *, api_key: str | None = None, opener=urlopen, sleep=time.sleep):
    headers = {"User-Agent": "WeatherCas/0.1 (official public metadata; 3-hour interval)",
               "Accept": "application/json"}
    if api_key:
        if not url.startswith("https://www.googleapis.com/youtube/v3/"):
            raise SourceError("invalid_key_destination")
        headers["X-Goog-Api-Key"] = api_key
    for attempt in range(3):
        try:
            with opener(Request(url, headers=headers), timeout=20) as response:
                raw = response.read(2_000_001)
                if len(raw) > 2_000_000:
                    raise SourceError("response_too_large")
                return json.loads(raw.decode("utf-8"))
        except HTTPError as exc:
            if exc.code not in (429, 500, 502, 503, 504) or attempt == 2:
                raise SourceError(f"http_{exc.code}") from None
            retry = exc.headers.get("Retry-After", "") if exc.headers else ""
            sleep(min(30, int(retry)) if retry.isdigit() else 2 ** attempt)
        except (URLError, TimeoutError, OSError):
            if attempt == 2:
                raise SourceError("network_error") from None
            sleep(2 ** attempt)
        except (ValueError, UnicodeError):
            raise SourceError("invalid_json") from None
    raise SourceError("request_failed")


def caster_lookup(catalog: dict) -> dict:
    result = {}
    for caster in catalog["casters"]:
        for alias in [caster["id"], *caster["aliases"]]:
            if alias in result:
                raise SourceError("duplicate_caster_alias")
            result[alias] = caster
    return result


def parse_schedule(payload, now: datetime, catalog: dict) -> list[dict]:
    if not isinstance(payload, list) or not 1 <= len(payload) <= 100:
        raise SourceError("schedule_shape_changed")
    names = caster_lookup(catalog)
    today = now.astimezone(JST).replace(second=0, microsecond=0)
    cursor = None
    rows = {}
    for item in payload:
        if not isinstance(item, dict) or not all(isinstance(item.get(k), str) for k in ("hour", "title", "caster")):
            raise SourceError("schedule_shape_changed")
        hour, program, raw_caster = item["hour"], item["title"].strip(), item["caster"]
        if not HOUR.fullmatch(hour) or not program or len(program) > 200 or not re.fullmatch(r"[a-z0-9_-]{0,64}", raw_caster):
            raise SourceError("schedule_invalid_value")
        hh, mm = map(int, hour.split(":"))
        point = today.replace(hour=hh, minute=mm)
        if cursor is None:
            if point > today:
                point -= timedelta(days=1)
            if today - point > timedelta(hours=6):
                raise SourceError("schedule_anchor_ambiguous")
            anchor = point
        else:
            point = cursor.replace(hour=hh, minute=mm)
            if point < cursor:
                point += timedelta(days=1)
        if point - anchor > timedelta(hours=48):
            raise SourceError("schedule_horizon_invalid")
        cursor = point
        caster = names.get(raw_caster)
        date = point.date().isoformat()
        key = date + "T" + hour
        record = {
            "id": key, "date_jst": date, "slot_start_jst": hour, "program": program,
            "date_basis": "rolling_schedule", "role": "presenter",
            "planned": {"caster_id": caster["id"] if caster else None,
                        "caster_name": caster["name"] if caster else None,
                        "raw_caster_id": raw_caster or None,
                        "source_url": SCHEDULE_URL, "source_type": "official_schedule",
                        "source_checked_at": stamp(now)},
            "confirmed": None, "status": "scheduled" if caster else "unverified",
            "youtube_video_id": None, "changes": [],
        }
        if key in rows and rows[key] != record:
            raise SourceError("schedule_conflicting_duplicate")
        rows[key] = record
    return list(rows.values())


def merge_records(previous: list[dict], incoming: list[dict]) -> list[dict]:
    """Preserve actual evidence and every change of the published plan."""
    merged = {r["id"]: copy.deepcopy(r) for r in previous}
    for current in incoming:
        row = copy.deepcopy(current)
        old = merged.get(row["id"])
        if old:
            row["confirmed"] = old["confirmed"]
            row["changes"] = copy.deepcopy(old["changes"])
            before = (old["program"], old["planned"]["caster_id"], old["planned"]["raw_caster_id"])
            after = (row["program"], row["planned"]["caster_id"], row["planned"]["raw_caster_id"])
            if before != after:
                row["changes"].append({"changed_at": row["planned"]["source_checked_at"],
                                       "previous_program": old["program"], "previous_plan": old["planned"]})
            if row["confirmed"]:
                row["status"] = "confirmed"
                row["youtube_video_id"] = old.get("youtube_video_id")
        merged[row["id"]] = row
    return sorted(merged.values(), key=lambda r: r["id"])


def parse_video(item) -> dict:
    if not isinstance(item, dict) or not isinstance(item.get("id"), str) or not VIDEO_ID.fullmatch(item["id"]):
        raise SourceError("video_id_invalid")
    if not isinstance(item.get("title"), str) or not 1 <= len(item["title"]) <= 500 or not isinstance(item.get("live"), bool):
        raise SourceError("video_shape_changed")
    published = item.get("publishedAt")
    if not isinstance(published, int) or isinstance(published, bool) or not 946684800 <= published <= 4102444800:
        raise SourceError("video_time_invalid")
    return {"id": item["id"], "title": item["title"], "source_url": VIDEOS_URL,
            "published_at": stamp(datetime.fromtimestamp(published, JST))}


def parse_videos(payload, now: datetime) -> dict:
    if not isinstance(payload, dict) or "live" not in payload or not isinstance(payload.get("ondemand"), list):
        raise SourceError("videos_shape_changed")
    if len(payload["ondemand"]) > 100:
        raise SourceError("videos_too_many")
    live_item = payload["live"]
    current = parse_video(live_item) if live_item else None
    archives = {v["id"]: v for v in (parse_video(v) for v in payload["ondemand"])}
    return {"schema_version": 1, "checked_at": stamp(now),
            "state": "listed" if current and live_item["live"] else "offline",
            "video": current if current and live_item["live"] else None,
            "embed_allowed": False, "verification": "official_listing",
            "archives": list(archives.values())}


def verify_oembed(payload, video_id: str) -> bool:
    return (isinstance(payload, dict) and payload.get("type") == "video"
            and payload.get("author_url") in ("https://www.youtube.com/@weathernews", "https://www.youtube.com/user/weathernews")
            and f"https://www.youtube.com/embed/{video_id}" in payload.get("html", ""))


def verify_api(payload, channel_id: str, video_id: str) -> tuple[str, bool]:
    if not isinstance(payload, dict) or not isinstance(payload.get("items"), list):
        raise SourceError("youtube_shape_changed")
    if not payload["items"]:
        return "offline", False
    item = payload["items"][0]
    if item.get("id") != video_id or item.get("snippet", {}).get("channelId") != channel_id:
        raise SourceError("youtube_channel_mismatch")
    details, snippet, status = item.get("liveStreamingDetails", {}), item.get("snippet", {}), item.get("status", {})
    embeddable = status.get("privacyStatus") == "public" and status.get("embeddable") is True
    live = snippet.get("liveBroadcastContent") == "live" and details.get("actualStartTime") and not details.get("actualEndTime")
    return ("live" if live else "offline"), embeddable


def validate_record(row: dict) -> None:
    try:
        date = datetime.strptime(row["date_jst"], "%Y-%m-%d").date().isoformat()
        assert date == row["date_jst"] and HOUR.fullmatch(row["slot_start_jst"])
        assert row["id"] == date + "T" + row["slot_start_jst"]
        assert isinstance(row["program"], str) and row["program"]
        assert row["status"] in ("scheduled", "confirmed", "unverified")
        assert row["date_basis"] == "rolling_schedule" and row["role"] == "presenter"
        planned = row["planned"]
        assert planned["source_url"] == SCHEDULE_URL and planned["source_type"] == "official_schedule"
        assert datetime.fromisoformat(planned["source_checked_at"]).tzinfo is not None
        assert isinstance(row["changes"], list)
        if row["status"] == "scheduled":
            assert planned["caster_id"] and planned["caster_name"]
        if row["confirmed"] is not None:
            actual = row["confirmed"]
            assert actual["caster_id"] and actual["caster_name"] and actual["source_url"].startswith("https://")
            assert datetime.fromisoformat(actual["source_checked_at"]).tzinfo is not None
            assert row["status"] == "confirmed"
        else:
            assert row["status"] != "confirmed"
        assert row["youtube_video_id"] is None or VIDEO_ID.fullmatch(row["youtube_video_id"])
    except (KeyError, ValueError, TypeError, AssertionError):
        raise SourceError("stored_record_invalid") from None


def load_records(data_dir: Path) -> list[dict]:
    rows = []
    for path in sorted(data_dir.glob("[0-9][0-9][0-9][0-9]/[0-9][0-9].json")):
        content = read_json(path)
        if not isinstance(content, dict) or content.get("schema_version") != 1 or not isinstance(content.get("records"), list):
            raise SourceError("stored_partition_invalid")
        for row in content["records"]:
            validate_record(row)
            if path.relative_to(data_dir).as_posix() != row["date_jst"][:7].replace("-", "/") + ".json":
                raise SourceError("stored_partition_mismatch")
        rows.extend(content["records"])
    if len({r["id"] for r in rows}) != len(rows):
        raise SourceError("stored_duplicate")
    return rows


def save_records(data_dir: Path, rows: list[dict], catalog: dict):
    groups = {}
    for row in rows:
        validate_record(row)
        month = row["date_jst"][:7].replace("-", "/")
        groups.setdefault(month, []).append(row)
    for month, values in groups.items():
        write_json(data_dir / f"{month}.json", {"schema_version": 1, "records": values})
    index = {"schema_version": 1, "months": sorted(groups), "casters": catalog["casters"],
             "count": len(rows), "earliest_date": min((r["date_jst"] for r in rows), default=None),
             "latest_date": max((r["date_jst"] for r in rows), default=None)}
    write_json(data_dir / "index.json", index)


def collect(data_dir: Path, log_dir: Path, *, now=None, fetch=fetch_json, api_key=None) -> dict:
    now = now or datetime.now(JST)
    checked = stamp(now)
    catalog = read_json(ROOT / "config/casters.json")
    previous = load_records(data_dir)
    old_status = read_json(data_dir / "status.json", {"sources": []})
    old_sources = {s["id"]: s for s in old_status["sources"]}
    sources, errors = [], []

    def outcome(source_id, label, url, action):
        old = old_sources.get(source_id, {})
        report = {"id": source_id, "label": label, "url": url, "checked_at": checked,
                  "last_success_at": old.get("last_success_at"), "last_failure_at": old.get("last_failure_at"),
                  "count": 0, "status": "ok", "message": "取得成功"}
        try:
            result = action()
            report.update(last_success_at=checked, count=len(result) if isinstance(result, list) else 1)
        except SourceError as exc:
            report.update(status="failed", last_failure_at=checked, message=str(exc))
            errors.append(source_id)
            result = None
        sources.append(report)
        return result

    incoming = outcome("schedule", "公式番組表", SCHEDULE_URL, lambda: parse_schedule(fetch(SCHEDULE_URL), now, catalog))
    rows = merge_records(previous, incoming) if incoming is not None else previous
    if incoming is not None:
        # Reject a sudden severe shrink before touching any known-good partition.
        recent = [r for r in previous if r["id"] >= incoming[0]["id"] and r["id"] <= incoming[-1]["id"]]
        if len(recent) > 5 and len(incoming) < len(recent) // 2:
            sources[-1].update(status="failed", message="schedule_count_anomaly", last_failure_at=checked,
                               last_success_at=old_sources.get("schedule", {}).get("last_success_at"))
            errors.append("schedule")
            rows = previous

    live = outcome("videos", "公式動画一覧", VIDEOS_URL, lambda: parse_videos(fetch(VIDEOS_URL), now))
    if live is None:
        old = read_json(data_dir / "live.json", {})
        live = {"schema_version": 1, "checked_at": checked, "state": "failed", "video": None,
                "embed_allowed": False, "verification": "unverified", "archives": old.get("archives", []),
                "archives_checked_at": old.get("archives_checked_at", old.get("checked_at"))}
    else:
        live["archives_checked_at"] = checked
    if live["video"]:
        vid = live["video"]["id"]
        url = "https://www.youtube.com/oembed?" + urlencode({"url": f"https://www.youtube.com/watch?v={vid}", "format": "json"})

        def embed_check():
            if not verify_oembed(fetch(url), vid):
                raise SourceError("embed_or_channel_unverified")
            return True

        live["embed_allowed"] = bool(outcome("embed", "YouTube公式埋め込み", "https://www.youtube.com/oembed", embed_check))
        if api_key:
            def api_check():
                channels = fetch("https://www.googleapis.com/youtube/v3/channels?part=id&forHandle=weathernews", api_key=api_key)
                try:
                    channel = channels["items"][0]["id"]
                except (KeyError, IndexError, TypeError):
                    raise SourceError("youtube_channel_unverified") from None
                videos = fetch("https://www.googleapis.com/youtube/v3/videos?" + urlencode({"part": "snippet,status,liveStreamingDetails", "id": vid}), api_key=api_key)
                return verify_api(videos, channel, vid)

            result = outcome("youtube", "YouTube LIVE判定", "https://www.googleapis.com/youtube/v3/videos", api_check)
            if result:
                live["state"], live["embed_allowed"] = result
                live["verification"] = "youtube_api"
            else:
                live.update(state="failed", embed_allowed=False)
        else:
            sources.append({"id": "youtube", "label": "YouTube LIVE判定", "url": "https://developers.google.com/youtube/v3/",
                            "status": "unconfigured", "checked_at": checked, "last_success_at": None,
                            "last_failure_at": None, "count": 0, "message": "APIキー未設定。現在LIVEとは断定しません。"})

    # All records have been validated in memory before replacing partitions.
    for row in rows:
        validate_record(row)
    save_records(data_dir, rows, catalog)
    write_json(data_dir / "live.json", live)
    quality = {"scheduled": sum(r["status"] == "scheduled" for r in rows),
               "confirmed": sum(r["status"] == "confirmed" for r in rows),
               "unverified": sum(r["status"] == "unverified" for r in rows),
               "changes": sum(len(r["changes"]) for r in rows)}
    status = {"schema_version": 1, "generated_at": checked, "sources": sources, "quality": quality,
              "healthy": not errors, "interval_hours": 3,
              "note": "公式番組表の観測を開始した範囲のみ。予定は出演実績ではありません。日付はJST収集時刻から整理。"}
    write_json(data_dir / "status.json", status)
    write_json(log_dir / now.astimezone(JST).strftime("%Y-%m/%d-%H%M%S.json"), status)
    return status


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-dir", type=Path, default=ROOT / "public/data")
    parser.add_argument("--log-dir", type=Path, default=ROOT / "Data/logs/collector")
    parser.add_argument("--validate-only", action="store_true")
    args = parser.parse_args()
    try:
        if args.validate_only:
            rows = load_records(args.data_dir)
            print(json.dumps({"valid": True, "records": len(rows)}))
            return 0
        report = collect(args.data_dir, args.log_dir, api_key=os.environ.get("YOUTUBE_API_KEY"))
        print(json.dumps({"healthy": report["healthy"], "quality": report["quality"]}))
        return 0 if report["healthy"] else 1
    except SourceError as exc:
        print(json.dumps({"error": str(exc)}), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
