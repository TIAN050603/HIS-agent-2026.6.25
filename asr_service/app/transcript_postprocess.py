# -*- coding: utf-8 -*-
"""Lightweight transcript normalization.

Raw transcript is always preserved. normalizedText is only a convenience for
filling the task input box; Universal Agent still performs semantic matching
with patient/options context.
"""

from __future__ import annotations

import re


CN_DIGITS = {
    "零": "0",
    "〇": "0",
    "一": "1",
    "幺": "1",
    "二": "2",
    "两": "2",
    "三": "3",
    "四": "4",
    "五": "5",
    "六": "6",
    "七": "7",
    "八": "8",
    "九": "9",
}

LOW_RISK_REPLACEMENTS = {
    "批零零一": "P001",
    "批零零二": "P002",
    "批零零三": "P003",
    "批零零四": "P004",
    "批零零五": "P005",
    "付诊": "复诊",
    "覆诊": "复诊",
    "初珍": "初诊",
}


def normalize_transcript(raw_text: str) -> str:
    text = (raw_text or "").strip()
    if not text:
        return ""
    for source, target in LOW_RISK_REPLACEMENTS.items():
        text = text.replace(source, target)
    text = normalize_patient_ids(text)
    text = normalize_phone_like_numbers(text)
    return re.sub(r"\s+", " ", text).strip()


def normalize_patient_ids(text: str) -> str:
    cn = "".join(CN_DIGITS)

    def repl(match: re.Match[str]) -> str:
        body = match.group(1)
        digits = "".join(CN_DIGITS.get(char, char) for char in body if char in CN_DIGITS or char.isdigit())
        if not digits:
            return match.group(0)
        return "P" + digits.zfill(3)[-3:]

    pattern = rf"(?:P|p|批)\s*([{cn}\d\s]{{1,8}})"
    return re.sub(pattern, repl, text)


def normalize_phone_like_numbers(text: str) -> str:
    digit_chars = "".join(CN_DIGITS)

    def repl(match: re.Match[str]) -> str:
        body = match.group(0)
        converted = "".join(CN_DIGITS.get(char, char) for char in body)
        digits = re.sub(r"\D", "", converted)
        return digits if len(digits) >= 7 else body

    return re.sub(rf"[{digit_chars}\d][{digit_chars}\d\s-]{{6,}}", repl, text)
