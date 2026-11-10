"""Collect links to official broadcasts, using the reference schedule for gaps."""
from datetime import date, timedelta
from html.parser import HTMLParser
import re
from time import monotonic
from urllib.parse import parse_qs, urlencode, urlsplit
from urllib.request import Request, urlopen


REFERENCE = "https://minorin.jp/wnl/caster.cgi"
VIDEO_ID = re.compile(r"[A-Za-z0-9_-]{11}")
TIME = re.compile(r"(?:[01]\d|2[0-3]):[0-5]\d")
PROGRAMS = dict(zip(("モーニング", "サンシャイン", "コーヒータイム", "アフタヌーン", "イブニング", "ムーン"),
                    ("05:00", "08:00", "11:00", "14:00", "17:00", "20:00")))
REGULAR_SLOTS = tuple(PROGRAMS.values())
LIVE_TITLE = re.compile(r"^【ライブ(?:配信終了)?】.*?(\d{4})年(\d{1,2})月(\d{1,2})日(?:\([^)]*\)|（[^）]*）)?\s*")
PRESENTERS = re.compile(r"〈ウェザーニュースLiVE[・\s]*([^・〉]+)・([^／/〉]+)(?:[／/]([^〉]+))?〉\s*$")


def reference_url(start, end):
    return f"{REFERENCE}?" + urlencode({"FROM": start, "TO": end})


class ReferenceRows(HTMLParser):
    """Read dated table rows and thumbnail links, skipping cross-talk text links."""

    def __init__(self):
        super().__init__()
        self.entries = []
        self.day = None
        self.cell = None
        self.slot = -1
        self.link = None
        self.in_row = False

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "tr":
            self.day, self.cell, self.slot, self.link = None, None, -1, None
            self.in_row = "wnlList" in (attrs.get("class") or "").split()
        elif tag == "td" and self.in_row:
            self.slot += 1
            self.cell, self.link = [], None
        elif tag == "a" and self.cell is not None:
            href = attrs.get("href") or ""
            if href.startswith("https://www.youtube.com/watch?"):
                ids = parse_qs(urlsplit(href).query).get("v", [])
                self.link = ids[0] if len(ids) == 1 and VIDEO_ID.fullmatch(ids[0]) else None
        elif tag == "img" and self.day and self.link:
            slot = REGULAR_SLOTS[self.slot - 1] if 1 <= self.slot <= len(REGULAR_SLOTS) else None
            self.entries.append((self.day, slot, self.link))

    def handle_data(self, data):
        if self.cell is not None:
            self.cell.append(data)

    def handle_endtag(self, tag):
        if tag == "tr":
            self.in_row, self.day = False, None
        elif tag == "a":
            self.link = None
        elif tag == "td" and self.cell is not None:
            if self.slot == 0:
                value = "".join(self.cell).strip()[:10]
                if re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
                    self.day = value
            self.cell, self.link = None, None


def fetch_reference(url):
    request = Request(url, headers={"User-Agent": "WeatherCas/0.1 (program archive links)"})
    with urlopen(request, timeout=12) as response:
        body = response.read(2_000_001)
        if len(body) > 2_000_000:
            raise ValueError("reference_too_large")
        return body.decode(response.headers.get_content_charset() or "utf-8")


def broadcast(title, video_id, reference_day=None, reference_slot=None):
    if not isinstance(title, str) or not 1 <= len(title) <= 500 or not VIDEO_ID.fullmatch(video_id):
        return None
    dated = LIVE_TITLE.match(title)
    if dated:
        try:
            day = date(*map(int, dated.groups())).isoformat()
        except ValueError:
            return None
        if reference_day and day != reference_day:
            return None
    elif reference_day and reference_slot is None:
        day = reference_day
    else:
        return None

    details = PRESENTERS.search(title)
    if details:
        program, caster, forecaster = details.groups()
        program = program.strip()
        slot = PROGRAMS.get(program)
        if reference_slot and slot and slot != reference_slot:
            return None
    else:
        program, slot, caster, forecaster = title, None, None, None
    if slot is None and dated:
        clock = TIME.match(title, dated.end())
        slot = clock.group() if clock else reference_slot
        if reference_slot and slot != reference_slot:
            return None
    return {"date_jst": day, "slot_start_jst": slot, "program": program,
            "caster_name": caster.strip() if caster else None,
            "forecaster_name": forecaster.strip() if forecaster else None,
            "video_id": video_id, "reference_url": reference_url(day, day) if reference_day else None}


def reference_broadcasts(today, saved, fetch_page, fetch_video, verify, days=7):
    start, end = today - timedelta(days=days), today - timedelta(days=1)
    parser = ReferenceRows()
    parser.feed(fetch_page(reference_url(start, end)))
    known_ids = {row["video_id"] for row in saved}
    known_slots = {(row["date_jst"], row["slot_start_jst"]) for row in saved
                   if row["slot_start_jst"] in PROGRAMS.values() and row["program"] in PROGRAMS}
    added = []
    attempts = 0
    deadline = monotonic() + 40
    for day, slot, video_id in sorted(dict.fromkeys(parser.entries), key=lambda entry: entry[0], reverse=True):
        if not start.isoformat() <= day <= end.isoformat() or video_id in known_ids or (day, slot) in known_slots:
            continue
        if attempts == 24 or monotonic() >= deadline:
            break
        attempts += 1
        try:
            item = fetch_video(video_id)
        except (ValueError, OSError):
            continue
        if not verify(item, video_id):
            continue
        row = broadcast(item.get("title"), video_id, day, slot)
        if row:
            added.append(row)
            known_ids.add(video_id)
            if slot:
                known_slots.add((day, slot))
    return added
