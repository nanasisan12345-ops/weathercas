"""Import historical schedule facts separately from official observations."""
import argparse
from calendar import monthrange
from datetime import date, datetime, timedelta
from pathlib import Path
import re
from time import sleep
from urllib.error import HTTPError

from .broadcasts import REGULAR_SLOTS, ReferenceRows, fetch_reference, reference_url
from .collect import JST, ROOT, read_json, write_json


FIRST_DATE = date(2021, 12, 1)
NAME = re.compile(r"[一-龯々ぁ-んァ-ヶー・\s]{2,32}")
BACKGROUND = re.compile(r"(?:^|;)\s*background-color\s*:\s*([^;]+)", re.I)
NO_NAMES = {"なし", "未定", "不明", "休止", "未確認"}


class ReferenceSchedule(ReferenceRows):
    def __init__(self):
        super().__init__()
        self.records = {}
        self.headers = []
        self.header_row = False
        self.people = {"casters": [], "forecasters": []}
        self.person = None
        self.depth = 0

    def handle_starttag(self, tag, attrs):
        super().handle_starttag(tag, attrs)
        if tag == "tr":
            self.header_row = False
        elif tag == "td":
            self.people = {"casters": [], "forecasters": []}
            self.person, self.depth = None, 0
        elif tag == "div" and self.day and 1 <= self.slot <= len(REGULAR_SLOTS):
            if self.depth:
                self.depth += 1
            elif self.cell is not None:
                color = BACKGROUND.search(dict(attrs).get("style") or "")
                if color:
                    role = "forecasters" if color[1].strip().lower() == "silver" else "casters"
                    self.person, self.depth = (role, []), 1

    def handle_data(self, data):
        super().handle_data(data)
        if self.person:
            self.person[1].append(data)

    def handle_endtag(self, tag):
        if tag == "div" and self.depth:
            self.depth -= 1
            if not self.depth:
                role, parts = self.person
                name = " ".join("".join(parts).split())
                if NAME.fullmatch(name) and name not in NO_NAMES and name not in self.people[role]:
                    self.people[role].append(name)
                self.person = None
        elif tag == "td" and self.cell is not None:
            content = "".join(self.cell).strip()
            if self.slot == 0:
                self.header_row = content == "日付"
            elif self.header_row and 1 <= self.slot <= len(REGULAR_SLOTS):
                self.headers.append(content[:5])
            elif self.day and 1 <= self.slot <= len(REGULAR_SLOTS) and any(self.people.values()):
                slot = REGULAR_SLOTS[self.slot - 1]
                key = (self.day, slot)
                if key in self.records and self.records[key] != self.people:
                    raise ValueError(f"conflicting reference slot: {self.day} {slot}")
                self.records[key] = self.people
        super().handle_endtag(tag)


def read_month(start, end, fetch=fetch_reference):
    parser = ReferenceSchedule()
    parser.feed(fetch(reference_url(start, end)))
    parser.close()
    if tuple(parser.headers[:6]) != REGULAR_SLOTS:
        raise ValueError("reference column headers changed")
    rows = [{"date_jst": day, "slot_start_jst": slot, **people}
            for (day, slot), people in sorted(parser.records.items())
            if start.isoformat() <= day <= end.isoformat()]
    if not rows:
        raise ValueError("no reference slots found")
    return rows


def import_range(folder, first, last):
    month = first.replace(day=1)
    index_path = folder / "index.json"
    counts = read_json(index_path, {"months": {}})["months"]
    failed = []
    while month <= last:
        key = month.strftime("%Y-%m")
        path = folder / f"{key}.json"
        end = min(last, month.replace(day=monthrange(month.year, month.month)[1]))
        existing = read_json(path, {"records": []})
        records = existing["records"]
        through = existing.get("through") or (records[-1]["date_jst"] if records else "")
        if records and counts.get(key) == len(records) and through >= end.isoformat():
            month = (month + timedelta(days=32)).replace(day=1)
            continue
        for delay in (0, 3, 8):
            sleep(delay)
            try:
                rows = read_month(month, end)
            except HTTPError as exc:
                reason = f"HTTP {exc.code}"
                if exc.code in (401, 403, 429):
                    raise RuntimeError(f"{key}: {reason}") from None
            except (OSError, ValueError) as exc:
                reason = str(exc)
            else:
                write_json(path, {"schema_version": 1, "through": end.isoformat(), "records": rows})
                counts[key] = len(rows)
                write_json(index_path, {"schema_version": 1, "months": dict(sorted(counts.items()))})
                print(f"{key}: {len(rows)} slots", flush=True)
                break
        else:
            failed.append(key)
            print(f"{key}: {reason}", flush=True)
        sleep(1.5)
        month = (month + timedelta(days=32)).replace(day=1)
    if failed:
        raise RuntimeError("missing months: " + ", ".join(failed))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--from", dest="first", type=date.fromisoformat, default=FIRST_DATE)
    parser.add_argument("--to", dest="last", type=date.fromisoformat, default=datetime.now(JST).date() - timedelta(days=1))
    parser.add_argument("--out", type=Path, default=ROOT / "public/data/reference-schedule")
    args = parser.parse_args()
    if args.first.day != 1 or not FIRST_DATE <= args.first <= args.last < datetime.now(JST).date():
        parser.error("choose a past date range starting on the first of a month on or after 2021-12-01")
    import_range(args.out, args.first, args.last)


if __name__ == "__main__":
    main()
