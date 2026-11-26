#!/usr/bin/env python3
"""
대구광역시 전월세 실거래가 3종 수집기 → 방봄 "전월세" 화면 자료

받는 곳 (공공데이터포털 국토교통부 Open API, 활용 신청 필요):
1. 연립다세대 전월세: https://www.data.go.kr/data/15126473/openapi.do
2. 단독/다가구 전월세: https://www.data.go.kr/data/15126472/openapi.do
3. 오피스텔 전월세:   https://www.data.go.kr/data/15126475/openapi.do

키: 팀 실거래가 수집기(fetch_rtms.py)와 같은 bangbom/.env 의 공공데이터포털 키를 쓴다
    (DATA_GO_KR_KEY 를 넣으면 fetch_rtms.py 가 암호화해서 DATA_GO_KR_KEY_ENC 로 바꿔 둔다. 둘 다 읽는다).
    키 값은 화면·기록·파일 어디에도 찍지 않는다.

만드는 것:
- bangbom/.cache_rent/daegu_{rowhouse,detached,officetel}_rent_3m.json : 원본을 정리한 전체 자료(올리지 않음)
- bangbom/data/daegu_rent.json : 사이트가 읽는 작은 자료(열 이름 + 줄 배열)

실행 (프로젝트 폴더에서):
  python -I bangbom/src/tools/collect_daegu_rent.py            # 최근 3개월
  python -I bangbom/src/tools/collect_daegu_rent.py --ym 202609 202610 202611
  python -I bangbom/src/tools/collect_daegu_rent.py --dry-run  # 부르지 않고 대상만 보기

받은 자료는 "신고된 지난 계약"이다. 지금 나와 있는 매물이 아니므로 화면에서도 실거래 기록으로만 보여 준다.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

try:
    sys.stdout.reconfigure(encoding="utf-8", line_buffering=True)
    sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]                     # bangbom/
CACHE = ROOT / ".cache_rent"
OUT_SITE = ROOT / "data" / "daegu_rent.json"

# 대구광역시 9개 구·군 법정동 앞 5자리 코드 (2023.07.01 군위군 편입 반영)
DAEGU_DISTRICTS: Dict[str, str] = {
    "27110": "중구", "27140": "동구", "27170": "서구", "27200": "남구", "27230": "북구",
    "27260": "수성구", "27290": "달서구", "27710": "달성군", "27720": "군위군",
}

API_SPECS: Dict[str, Dict[str, str]] = {
    "rowhouse": {
        "title": "국토교통부_연립다세대 전월세 실거래가 자료",
        "category_label": "연립/다세대",
        "portal_url": "https://www.data.go.kr/data/15126473/openapi.do",
        "endpoint": "https://apis.data.go.kr/1613000/RTMSDataSvcRHRent/getRTMSDataSvcRHRent",
        "output_filename": "daegu_rowhouse_rent_3m.json",
        "area_type": "전용면적",
        "code": "r",
    },
    "detached": {
        "title": "국토교통부_단독/다가구 전월세 실거래가 자료",
        "category_label": "단독/다가구",
        "portal_url": "https://www.data.go.kr/data/15126472/openapi.do",
        "endpoint": "https://apis.data.go.kr/1613000/RTMSDataSvcSHRent/getRTMSDataSvcSHRent",
        "output_filename": "daegu_detached_rent_3m.json",
        "area_type": "계약/연면적",
        "code": "d",
    },
    "officetel": {
        "title": "국토교통부_오피스텔 전월세 실거래가 자료",
        "category_label": "오피스텔",
        "portal_url": "https://www.data.go.kr/data/15126475/openapi.do",
        "endpoint": "https://apis.data.go.kr/1613000/RTMSDataSvcOffiRent/getRTMSDataSvcOffiRent",
        "output_filename": "daegu_officetel_rent_3m.json",
        "area_type": "전용면적",
        "code": "o",
    },
}

# 사이트 자료의 열 순서 (bangbom/src/shell/rent.js 의 COLS 와 같아야 한다)
SITE_COLS = ["cat", "gu", "dong", "name", "area", "floor", "year", "deposit", "rent", "date", "ctype"]


def load_key() -> str:
    """bangbom/.env 의 공공데이터포털 키. fetch_rtms.py 의 읽기(암호화 저장 포함)를 그대로 쓴다."""
    sys.path.insert(0, str(HERE))
    try:
        import fetch_rtms  # noqa: E402  같은 폴더의 팀 수집기
        return fetch_rtms.load_key() or ""
    except Exception:
        return ""
    finally:
        sys.path.pop(0)


def get_recent_months(count: int = 3, base_date: Optional[datetime] = None) -> List[str]:
    """기준일 포함 최근 N개월의 YYYYMM 리스트를 오래된 순으로 반환."""
    now = base_date or datetime.now()
    year, month = now.year, now.month
    months: List[str] = []
    for _ in range(count):
        months.append(f"{year:04d}{month:02d}")
        month -= 1
        if month == 0:
            month, year = 12, year - 1
    months.reverse()
    return months


def parse_int(value: Optional[str]) -> Optional[int]:
    if not value:
        return None
    cleaned = value.replace(",", "").strip()
    if not cleaned:
        return None
    try:
        return int(float(cleaned))
    except ValueError:
        return None


def parse_float(value: Optional[str]) -> Optional[float]:
    if not value:
        return None
    cleaned = value.replace(",", "").strip()
    if not cleaned:
        return None
    try:
        return round(float(cleaned), 2)
    except ValueError:
        return None


def format_korean_manwon(manwon: int) -> str:
    """만원 단위 정수를 '1억 2,000', '5,000' 같은 표기로."""
    if manwon >= 10000:
        eok, rem = divmod(manwon, 10000)
        return f"{eok}억 {rem:,}" if rem else f"{eok}억"
    return f"{manwon:,}"


def build_price_label(deposit: int, monthly_rent: int) -> Tuple[str, str]:
    if monthly_rent > 0:
        return "월세", f"월세 {format_korean_manwon(deposit)}/{monthly_rent:,}"
    return "전세", f"전세 {format_korean_manwon(deposit)}"


def fetch_xml(url: str, timeout: int = 20, retries: int = 3) -> bytes:
    """HTTPS로만 요청한다(키가 주소에 들어가므로 HTTP로 바꿔 보내지 않는다). 실패하면 잠깐 쉬고 다시."""
    last_err = ""
    for attempt in range(1, retries + 1):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "bangbom-rent-collector/1.0"})
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return resp.read()
        except urllib.error.HTTPError as exc:
            last_err = f"HTTP {exc.code}"
        except (urllib.error.URLError, TimeoutError) as exc:
            last_err = type(exc).__name__   # 주소(키 포함)는 남기지 않는다
        if attempt < retries:
            time.sleep(0.6 * attempt)
    raise RuntimeError(f"API 요청 실패: {last_err}")


def parse_api_response(xml_bytes: bytes) -> Tuple[List[Dict[str, str]], int]:
    root = ET.fromstring(xml_bytes)
    err_msg = root.findtext(".//cmmMsgHeader/returnAuthMsg") or root.findtext(".//cmmMsgHeader/errMsg")
    if err_msg:
        reason_code = root.findtext(".//cmmMsgHeader/returnReasonCode") or ""
        raise RuntimeError(f"공공데이터포털 인증/서비스 오류 ({reason_code}): {err_msg}")
    result_code = (root.findtext("./header/resultCode") or "").strip()
    result_msg = (root.findtext("./header/resultMsg") or "").strip()
    if result_code not in ("00", "000"):
        raise RuntimeError(f"API 응답 오류 ({result_code}): {result_msg}")
    total_count = parse_int(root.findtext("./body/totalCount")) or 0
    items = [{child.tag: (child.text or "").strip() for child in el} for el in root.findall("./body/items/item")]
    return items, total_count


def normalize_item(category: str, item: Dict[str, str], lawd_cd: str, deal_ym: str) -> Dict[str, Any]:
    """3개 API의 서로 다른 원시 필드를 한 가지 매물 카드 구조로 (daegu_rent_types.ts 의 DaeguRentListing)."""
    spec = API_SPECS[category]
    district = DAEGU_DISTRICTS.get(lawd_cd, item.get("sggNm", ""))
    dong = item.get("umdNm", "")
    jibun = item.get("jibun", "")
    deposit = parse_int(item.get("deposit")) or 0
    monthly_rent = parse_int(item.get("monthlyRent")) or 0
    rent_type, price_label = build_price_label(deposit, monthly_rent)

    if category == "rowhouse":
        building_name = item.get("mhouseNm") or f"{dong} {item.get('houseType', '연립/다세대')}".strip()
        house_type = item.get("houseType") or "연립/다세대"
        area_sqm = parse_float(item.get("excluUseAr"))
        floor = item.get("floor") or None
    elif category == "detached":
        house_type = item.get("houseType") or "단독/다가구"
        building_name = f"{dong} {house_type}".strip()
        area_sqm = parse_float(item.get("totalFloorAr"))
        floor = None
    else:
        building_name = item.get("offiNm") or item.get("offiname") or f"{dong} 오피스텔".strip()
        house_type = "오피스텔"
        area_sqm = parse_float(item.get("excluUseAr"))
        floor = item.get("floor") or None

    area_pyeong = round(area_sqm / 3.305785, 1) if area_sqm is not None else None
    build_year = parse_int(item.get("buildYear"))
    deal_year = item.get("dealYear") or deal_ym[:4]
    deal_month = (item.get("dealMonth") or deal_ym[4:6]).zfill(2)
    deal_day = (item.get("dealDay") or "01").zfill(2)
    deal_date = f"{deal_year}-{deal_month}-{deal_day}"
    display_address = " ".join(p for p in ["대구광역시", district, dong, jibun] if p)

    fingerprint = "|".join([category, lawd_cd, dong, jibun, building_name, str(area_sqm or ""), str(floor or ""),
                            deal_date, str(deposit), str(monthly_rent), item.get("contractTerm", "")])
    listing_id = f"{category[:2]}_{hashlib.md5(fingerprint.encode('utf-8')).hexdigest()[:12]}"

    summary = [house_type]
    if area_sqm is not None and area_pyeong is not None:
        summary.append(f"{area_sqm}㎡({area_pyeong}평)")
    if floor:
        summary.append(f"{floor}층")
    if build_year:
        summary.append(f"{build_year}년")

    return {
        "id": listing_id, "category": category, "categoryLabel": spec["category_label"], "houseType": house_type,
        "rentType": rent_type, "title": building_name, "subtitle": " · ".join(summary),
        "price": {"depositManwon": deposit, "monthlyRentManwon": monthly_rent, "priceLabel": price_label},
        "building": {"name": building_name, "areaSqm": area_sqm, "areaPyeong": area_pyeong, "areaType": spec["area_type"],
                     "floor": floor, "buildYear": build_year},
        "location": {"sido": "대구광역시", "sggCd": lawd_cd, "district": district, "dong": dong, "jibun": jibun or None,
                     "displayAddress": display_address},
        "contract": {"dealDate": deal_date, "dealYm": f"{deal_year}{deal_month}", "term": item.get("contractTerm") or None,
                     "type": item.get("contractType") or None, "renewalRightUsed": item.get("useRRRight") or None,
                     "preDepositManwon": parse_int(item.get("preDeposit")),
                     "preMonthlyRentManwon": parse_int(item.get("preMonthlyRent"))},
    }


def collect_category(category: str, key: str, months: List[str], num_of_rows: int = 1000, delay_sec: float = 0.1) -> Dict[str, Any]:
    """한 주택 유형: 대구 9개 구·군 × 대상 월 전체."""
    spec = API_SPECS[category]
    listings: List[Dict[str, Any]] = []
    seen = set()
    encoded = urllib.parse.quote(key, safe="")
    print(f"\n[{spec['category_label']}] 받기 시작 ({', '.join(months)})")
    for lawd_cd, district_name in DAEGU_DISTRICTS.items():
        n = 0
        for deal_ym in months:
            page_no = 1
            while True:
                url = f"{spec['endpoint']}?serviceKey={encoded}&LAWD_CD={lawd_cd}&DEAL_YMD={deal_ym}&pageNo={page_no}&numOfRows={num_of_rows}"
                raw_items, total = parse_api_response(fetch_xml(url))
                for raw in raw_items:
                    item = normalize_item(category, raw, lawd_cd, deal_ym)
                    if item["id"] not in seen:
                        seen.add(item["id"])
                        listings.append(item)
                        n += 1
                pages = math.ceil(total / num_of_rows) if total > 0 else 1
                if page_no >= pages or not raw_items:
                    break
                page_no += 1
                time.sleep(delay_sec)
            time.sleep(delay_sec)
        print(f"  - 대구 {district_name}({lawd_cd}): {n:,}건")
    listings.sort(key=lambda x: (x["contract"]["dealDate"], x["price"]["depositManwon"]), reverse=True)
    return {
        "meta": {"source": spec["title"], "sourceUrl": spec["portal_url"], "region": "대구광역시", "districts": DAEGU_DISTRICTS,
                 "months": months, "generatedAt": datetime.now(timezone.utc).isoformat(), "totalCount": len(listings)},
        "listings": listings,
    }


def site_rows(datasets: Dict[str, Dict[str, Any]]) -> Dict[str, Any]:
    """사이트용 작은 자료: 열 이름 한 번 + 줄마다 값 배열. 지번은 넣지 않는다(카드는 동까지만 보여 준다)."""
    rows: List[list] = []
    for category, ds in datasets.items():
        code = API_SPECS[category]["code"]
        for x in ds["listings"]:
            b, loc, p, c = x["building"], x["location"], x["price"], x["contract"]
            rows.append([code, loc["district"], loc["dong"], b["name"], b["areaSqm"], b["floor"], b["buildYear"],
                         p["depositManwon"], p["monthlyRentManwon"], c["dealDate"], c["type"]])
    rows.sort(key=lambda r: r[9], reverse=True)
    any_ds = next(iter(datasets.values()))
    return {
        "meta": {
            "sources": [{"name": API_SPECS[k]["title"], "url": API_SPECS[k]["portal_url"], "count": d["meta"]["totalCount"]} for k, d in datasets.items()],
            "months": any_ds["meta"]["months"],
            "generatedAt": datetime.now(timezone.utc).isoformat(),
            "unit": "만원",
            "note": "신고된 지난 전월세 계약이에요. 지금 나와 있는 매물이 아니에요.",
        },
        "cols": SITE_COLS,
        "rows": rows,
    }


def main() -> int:
    ap = argparse.ArgumentParser(description="대구 전월세 실거래 3종 → 방봄 전월세 화면 자료")
    ap.add_argument("--months", type=int, default=3, help="최근 몇 개월 (기본 3)")
    ap.add_argument("--ym", nargs="+", help="계약년월 직접 지정 (예: --ym 202609 202610 202611)")
    ap.add_argument("--dry-run", action="store_true", help="부르지 않고 대상과 저장 위치만 보기")
    args = ap.parse_args()
    months = args.ym or get_recent_months(args.months)

    if args.dry_run:
        print("=== 미리 보기 (API를 부르지 않아요) ===")
        print(f"지역: 대구광역시 {len(DAEGU_DISTRICTS)}개 구·군 ({', '.join(DAEGU_DISTRICTS.values())})")
        print(f"기간: {', '.join(months)}")
        for spec in API_SPECS.values():
            print(f"  - {spec['category_label']} -> {CACHE / spec['output_filename']}")
        print(f"  - 사이트 자료 -> {OUT_SITE}")
        return 0

    key = load_key()
    if not key:
        print("[오류] 공공데이터포털 키가 없어요. bangbom/.env 에 DATA_GO_KR_KEY=인증키(Decoding) 한 줄을 넣고 다시 실행해 주세요.", file=sys.stderr)
        return 1

    CACHE.mkdir(parents=True, exist_ok=True)
    datasets: Dict[str, Dict[str, Any]] = {}
    for category, spec in API_SPECS.items():
        try:
            ds = collect_category(category, key, months)
        except RuntimeError as exc:
            print(f"[오류] {spec['category_label']}: {exc}\n  공공데이터포털에서 이 API 활용 신청이 승인됐는지 확인해 주세요: {spec['portal_url']}", file=sys.stderr)
            return 1
        (CACHE / spec["output_filename"]).write_text(json.dumps(ds, ensure_ascii=False, indent=2), encoding="utf-8")
        datasets[category] = ds
        print(f"  => {spec['category_label']} {ds['meta']['totalCount']:,}건")

    OUT_SITE.parent.mkdir(parents=True, exist_ok=True)
    site = site_rows(datasets)
    OUT_SITE.write_text(json.dumps(site, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"\n사이트 자료를 만들었어요: {OUT_SITE} ({len(site['rows']):,}건, {OUT_SITE.stat().st_size / 1024:,.0f}KB)")
    print("다음: python -I bangbom/src/shell/build.py && node scripts/sync-bangbom.mjs")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
