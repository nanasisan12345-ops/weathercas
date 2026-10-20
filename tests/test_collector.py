import copy
from datetime import datetime
from io import BytesIO
import json
from pathlib import Path
import tempfile
import unittest
from urllib.error import HTTPError, URLError

from collector.collect import (ROOT, SCHEDULE_URL, VIDEOS_URL, SourceError, collect,
    fetch_json, load_records, merge_records, parse_schedule, parse_videos,
    read_json, save_records, validate_record, verify_api, verify_oembed)

NOW = datetime.fromisoformat("2026-10-20T10:30:00+09:00")
CATALOG = read_json(ROOT / "config/casters.json")
FIXTURES = Path(__file__).parent / "fixtures"


class ScheduleTests(unittest.TestCase):
    def setUp(self):
        self.payload = read_json(FIXTURES / "schedule.json")

    def test_observed_schedule_and_alias(self):
        rows = parse_schedule(self.payload, NOW, CATALOG)
        self.assertEqual(len(rows), 10)
        self.assertEqual(rows[0]["planned"]["caster_id"], "matsumoto")
        self.assertEqual(rows[0]["status"], "scheduled")
        for row in rows:
            validate_record(row)

    def test_midnight_and_year_boundary(self):
        payload = [{"hour": h, "title": "番組", "caster": "ogawa"} for h in ["23:00", "00:00", "05:00"]]
        rows = parse_schedule(payload, datetime.fromisoformat("2026-12-31T23:30:00+09:00"), CATALOG)
        self.assertEqual([r["date_jst"] for r in rows], ["2026-12-31", "2027-01-01", "2027-01-01"])
        # After midnight, the current 23:00 slot belongs to the previous date.
        rows = parse_schedule(payload, datetime.fromisoformat("2027-01-01T01:30:00+09:00"), CATALOG)
        self.assertEqual(rows[0]["date_jst"], "2026-12-31")

    def test_duplicate_is_idempotent(self):
        once = parse_schedule(self.payload, NOW, CATALOG)
        duplicate = parse_schedule([self.payload[0], *self.payload], NOW, CATALOG)
        self.assertEqual(once, duplicate)
        self.assertEqual(merge_records(once, once), once)

    def test_unknown_caster_and_empty_caster_are_unverified(self):
        for caster in ["newcaster", ""]:
            payload = [{**self.payload[0], "caster": caster}]
            row = parse_schedule(payload, NOW, CATALOG)[0]
            self.assertEqual(row["status"], "unverified")
            self.assertIsNone(row["planned"]["caster_name"])

    def test_empty_malformed_and_ambiguous_are_rejected(self):
        for payload in [[], {}, [{"hour": "25:00", "title": "番組", "caster": "ogawa"}],
                        [{"hour": "08:00", "title": "番組"}],
                        [{"hour": "11:00", "title": "番組", "caster": "ogawa"}]]:
            with self.subTest(payload=payload), self.assertRaises(SourceError):
                parse_schedule(payload, NOW, CATALOG)

    def test_planned_change_retains_actual_and_history(self):
        old = parse_schedule(self.payload[:1], NOW, CATALOG)
        old[0]["confirmed"] = {"caster_id": "ogawa", "caster_name": "小川 千奈",
            "source_url": "https://weathernews.jp/wnl/", "source_checked_at": NOW.isoformat()}
        old[0]["status"] = "confirmed"
        newer = parse_schedule([{**self.payload[0], "caster": "ogawa"}], NOW, CATALOG)
        merged = merge_records(old, newer)
        self.assertEqual(merged[0]["confirmed"], old[0]["confirmed"])
        self.assertEqual(merged[0]["status"], "confirmed")
        self.assertEqual(len(merged[0]["changes"]), 1)
        self.assertEqual(merge_records(merged, newer), merged)
        self.assertEqual(old[0]["changes"], [])

    def test_partition_roundtrip_and_corrupt_data_guard(self):
        rows = parse_schedule(self.payload, NOW, CATALOG)
        with tempfile.TemporaryDirectory(dir=ROOT / "Data/temp") as temp:
            data = Path(temp)
            save_records(data, rows, CATALOG)
            self.assertEqual(load_records(data), rows)
            broken = copy.deepcopy(rows[0])
            broken["status"] = "confirmed"
            with self.assertRaises(SourceError):
                validate_record(broken)


class VideoTests(unittest.TestCase):
    def test_observed_listing_is_not_api_verified_live(self):
        parsed = parse_videos(read_json(FIXTURES / "videos.json"), NOW)
        self.assertEqual(parsed["state"], "listed")
        self.assertFalse(parsed["embed_allowed"])

    def test_no_live_video_and_invalid_id(self):
        self.assertEqual(parse_videos({"live": None, "ondemand": []}, NOW)["state"], "offline")
        with self.assertRaises(SourceError):
            parse_videos({"live": {"id": "javascript:evil"}, "ondemand": []}, NOW)

    def test_oembed_author_and_embed(self):
        payload = {"type": "video", "author_url": "https://www.youtube.com/@weathernews",
                   "html": '<iframe src="https://www.youtube.com/embed/abcdefghijk"></iframe>'}
        self.assertTrue(verify_oembed(payload, "abcdefghijk"))
        self.assertFalse(verify_oembed({**payload, "author_url": "https://example.com"}, "abcdefghijk"))

    def test_api_live_ended_private_and_foreign_channel(self):
        item = {"id": "abcdefghijk", "snippet": {"channelId": "official", "liveBroadcastContent": "live"},
                "status": {"privacyStatus": "public", "embeddable": True},
                "liveStreamingDetails": {"actualStartTime": "2026-10-20T01:00:00Z"}}
        self.assertEqual(verify_api({"items": [item]}, "official", "abcdefghijk"), ("live", True))
        ended = copy.deepcopy(item)
        ended["liveStreamingDetails"]["actualEndTime"] = "2026-10-20T02:00:00Z"
        self.assertEqual(verify_api({"items": [ended]}, "official", "abcdefghijk")[0], "offline")
        private = copy.deepcopy(item)
        private["status"]["privacyStatus"] = "private"
        self.assertFalse(verify_api({"items": [private]}, "official", "abcdefghijk")[1])
        with self.assertRaises(SourceError):
            verify_api({"items": [item]}, "foreign", "abcdefghijk")


class NetworkTests(unittest.TestCase):
    def test_429_retry_after_and_then_success(self):
        calls, waits = [], []
        def opener(req, timeout):
            calls.append(req.full_url)
            if len(calls) == 1:
                raise HTTPError(req.full_url, 429, "rate", {"Retry-After": "99"}, None)
            return BytesIO(b'{"ok": true}')
        self.assertEqual(fetch_json("https://example.com", opener=opener, sleep=waits.append), {"ok": True})
        self.assertEqual(waits, [30])
        self.assertEqual(len(calls), 2)

    def test_network_down_retries_three_times(self):
        calls = []
        def opener(*args, **kwargs):
            calls.append(1)
            raise URLError("secret URL must not be logged")
        with self.assertRaisesRegex(SourceError, "^network_error$"):
            fetch_json("https://example.com", opener=opener, sleep=lambda _: None)
        self.assertEqual(len(calls), 3)

    def test_invalid_json_is_not_retried(self):
        with self.assertRaisesRegex(SourceError, "invalid_json"):
            fetch_json("https://example.com", opener=lambda *a, **kw: BytesIO(b""), sleep=lambda _: None)

    def test_key_cannot_be_sent_elsewhere(self):
        with self.assertRaisesRegex(SourceError, "invalid_key_destination"):
            fetch_json("https://example.com", api_key="test-key")

    def test_source_failure_keeps_partition_and_drops_live(self):
        with tempfile.TemporaryDirectory(dir=ROOT / "Data/temp") as temp:
            data, logs = Path(temp) / "data", Path(temp) / "logs"
            rows = parse_schedule(read_json(FIXTURES / "schedule.json"), NOW, CATALOG)
            save_records(data, rows, CATALOG)
            partition = data / "2026/10.json"
            before = partition.read_bytes()
            def fail(*args, **kwargs):
                raise SourceError("network_error")
            report = collect(data, logs, now=NOW, fetch=fail)
            self.assertFalse(report["healthy"])
            self.assertEqual(partition.read_bytes(), before)
            self.assertEqual(read_json(data / "live.json")["state"], "failed")
            self.assertIsNone(read_json(data / "live.json")["video"])

    def test_mock_full_collection_and_safe_api_error(self):
        def fetch(url, **kwargs):
            if url == SCHEDULE_URL:
                return read_json(FIXTURES / "schedule.json")
            if url == VIDEOS_URL:
                return read_json(FIXTURES / "videos.json")
            if "oembed" in url:
                return {"type": "video", "author_url": "https://www.youtube.com/@weathernews",
                        "html": "https://www.youtube.com/embed/LbMd2BvWHHU"}
            raise SourceError("http_403")
        with tempfile.TemporaryDirectory(dir=ROOT / "Data/temp") as temp:
            data, logs = Path(temp) / "data", Path(temp) / "logs"
            report = collect(data, logs, now=NOW, fetch=fetch)
            self.assertTrue(report["healthy"])
            self.assertEqual(report["quality"]["confirmed"], 0)
            self.assertEqual(read_json(data / "live.json")["state"], "listed")
            report = collect(data, logs, now=NOW, fetch=fetch, api_key="not-a-real-secret")
            self.assertFalse(report["healthy"])
            text = (data / "status.json").read_text(encoding="utf-8")
            self.assertNotIn("not-a-real-secret", text)
            self.assertEqual(read_json(data / "live.json")["state"], "failed")


if __name__ == "__main__":
    unittest.main()
