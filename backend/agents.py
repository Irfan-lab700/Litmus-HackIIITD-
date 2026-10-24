import asyncio, hashlib, json, os, re, time
from datetime import date, timedelta
from typing import Awaitable, Callable, Optional
from urllib.parse import urlparse

import httpx
from dotenv import load_dotenv

load_dotenv()
API_KEY = os.getenv("TINYFISH_API_KEY", "")
AGENT_URL = "https://agent.tinyfish.ai/v1/automation/run-sse"
SEARCH_URL = "https://api.search.tinyfish.ai"
DEMO = not API_KEY
ENRICH = os.getenv("TINYFISH_AGENT_ENRICH", "").lower() in ("1", "true", "yes")
Progress = Optional[Callable[[str], Awaitable[None]]]

REGISTRY_SITES = ["zaubacorp.com", "tofler.in", "thecompanycheck.com", "falconebiz.com", "instafinancials.com", "mca.gov.in"]
JOB_SITES = ["naukri.com", "indeed.com", "instahyre.com", "linkedin.com", "glassdoor.co.in", "foundit.in", "wellfound.com"]
CIN_RE = re.compile(r"\b[LU]\d{5}[A-Z]{2}\d{4}[A-Z]{3}\d{6}\b")
NEG_STATUS = [("strike off", "Strike Off"), ("struck off", "Strike Off"), ("dissolved", "Dissolved"),
              ("liquidat", "Liquidated"), ("amalgamat", "Amalgamated"), ("inactive", "Inactive")]
LAYOFF_RE = re.compile(r"layoff|lay off|laid off|job cuts?|retrench|downsiz|shuts? down|salary (?:delay|cut)", re.I)
SUFFIX = {"limited", "ltd", "pvt", "private", "llp", "inc", "corp", "co", "company", "the", "opc", "plc"}

_mca_cache: dict[str, tuple[float, dict]] = {}   # smart caching for verified companies
MCA_TTL = 24 * 3600


# ---------------- helpers ----------------
def tokens(name: str) -> list[str]:
    return [t for t in re.findall(r"[a-z0-9]+", name.lower()) if t not in SUFFIX]

def mentions(name: str, text: str) -> bool:
    tk, t = tokens(name), text.lower()
    return bool(tk) and all(x in t for x in tk)

def _seed(s: str, salt: str) -> int:
    return int(hashlib.md5(f"{salt}:{s.lower()}".encode()).hexdigest(), 16)

async def _say(on_progress: Progress, msg: str):
    if on_progress: await on_progress(msg)

async def _fake(on_progress: Progress, msgs: list[str]):
    for m in msgs:
        await _say(on_progress, m); await asyncio.sleep(0.5)


async def search(query: str, include: list[str] | None = None, news: bool = False, after: str | None = None) -> list[dict]:
    params = {"query": query, "location": "IN", "language": "en"}
    if include: params["include_domains"] = ",".join(include)
    if news: params["domain_type"] = "news"
    if after: params["after_date"] = after
    for attempt in range(3):
        async with httpx.AsyncClient(timeout=30) as c:
            r = await c.get(SEARCH_URL, params=params, headers={"X-API-Key": API_KEY})
        if r.status_code in (429, 503) and attempt < 2:
            await asyncio.sleep(1.5 * (attempt + 1)); continue
        if r.status_code >= 400:
            raise RuntimeError(f"TinyFish Search HTTP {r.status_code}: {r.text[:200]}")
        return r.json().get("results", [])
    return []


async def run_agent(url: str, goal: str, schema: dict, on_progress: Progress = None,
                    stealth: bool = False, country: str = "IN", max_seconds: int = 90) -> dict:
    body = {"url": url, "goal": goal, "output_schema": schema,
            "browser_profile": "stealth" if stealth else "lite",
            "proxy_config": {"enabled": True, "type": "tinyfish", "country_code": country},
            "agent_config": {"max_duration_seconds": max_seconds}}
    async with httpx.AsyncClient(timeout=httpx.Timeout(max_seconds + 30, connect=15.0)) as c:
        async with c.stream("POST", AGENT_URL, headers={"X-API-Key": API_KEY}, json=body) as r:
            if r.status_code >= 400:
                raise RuntimeError(f"TinyFish HTTP {r.status_code}: {(await r.aread()).decode()[:300]}")
            async for line in r.aiter_lines():
                if not line.startswith("data:"): continue
                ev = json.loads(line[5:].strip())
                if ev.get("type") == "PROGRESS":
                    await _say(on_progress, ev.get("purpose", ""))
                elif ev.get("type") == "COMPLETE":
                    if ev.get("status") == "COMPLETED":
                        res = ev.get("result") or {}
                        if isinstance(res, str):
                            try: res = json.loads(res)
                            except json.JSONDecodeError: res = {"raw": res}
                        return res
                    raise RuntimeError((ev.get("error") or {}).get("message") or f"run {ev.get('status')}")
    raise RuntimeError("TinyFish stream ended without a result")


# ---------------- job link -> company ----------------
async def resolve_job(url: str, on_progress: Progress = None) -> dict:
    host = urlparse(url).netloc.replace("www.", "")
    if DEMO:
        await _fake(on_progress, ["Opening job posting"])
        return {"company": host.split(".")[0].title(), "title": "Software Engineer Intern"}
    try:
        return await run_agent(
            url, "Open this job posting and return the hiring company's name and the job title. "
                 "Return the hiring company, not the job board.",
            {"type": "object", "properties": {"company": {"type": "string"}, "title": {"type": "string"}},
             "required": ["company"]}, on_progress, stealth=True, max_seconds=60)
    except Exception:
        if any(j in host for j in ("linkedin", "naukri", "indeed", "instahyre", "glassdoor", "foundit")):
            raise RuntimeError("that job board blocks automated reading, paste the company name instead")
        return {"company": host.split(".")[0].title(), "title": ""}


# ---------------- 1. LEGAL: public MCA-data mirrors via Search ----------------
async def check_mca(company: str, on_progress: Progress = None) -> dict:
    key = company.strip().lower()
    hit = _mca_cache.get(key)
    if hit and time.time() - hit[0] < MCA_TTL:
        await _say(on_progress, "Loaded from verified-company cache")
        return {**hit[1], "cached": True}

    if DEMO:
        await _fake(on_progress, ["Searching MCA-data registries", "Reading CIN and status"])
        bad = any(w in key for w in ("scam", "fake", "shell", "quick"))
        res = {"found": not bad, "negative": False, "status": "" if bad else "Active",
               "cin": "" if bad else f"U72900KA2019PTC{_seed(key, 'c') % 10**6:06d}",
               "source_url": "" if bad else "https://www.zaubacorp.com/"}
    else:
        res = {"found": False, "negative": False, "status": "", "cin": "", "source_url": ""}
        await _say(on_progress, "Searching public MCA-data registries (Zauba, Tofler...)")
        results = await search(f"{company} CIN company master data", include=REGISTRY_SITES)
        if not any(CIN_RE.search(f"{r.get('title','')} {r.get('snippet','')} {r.get('url','')}") and
                   mentions(company, f"{r.get('title','')} {r.get('snippet','')}") for r in results):
            await _say(on_progress, "Trying a broader search")
            results += await search(f"{company} CIN registered company India MCA")
        for r in results:
            text = f"{r.get('title','')} {r.get('snippet','')} {r.get('url','')}"
            m = CIN_RE.search(text)
            if not (m and mentions(company, f"{r.get('title','')} {r.get('snippet','')}")):
                continue
            low = text.lower()
            neg = next((lbl for k, lbl in NEG_STATUS if k in low), "")
            res = {"found": True, "negative": bool(neg), "cin": m.group(0), "source_url": r.get("url", ""),
                   "status": neg or ("Active" if re.search(r"\bactive\b", low) else "Registered (status not shown)")}
            break
        if res["found"]:
            await _say(on_progress, f"Found CIN {res['cin']} ({res['status']})")
            if ENRICH and res["source_url"]:  # optional: TinyFish Agent opens the public registry page
                try:
                    extra = await run_agent(
                        res["source_url"], "On this company page read the company status, date of last AGM and "
                        "date of last balance sheet filing.",
                        {"type": "object", "properties": {"status": {"type": "string"}, "last_agm": {"type": "string"},
                         "last_filing": {"type": "string"}}}, on_progress, max_seconds=60)
                    if extra.get("status"): res["status"] = extra["status"]
                    res["last_filing"] = extra.get("last_filing", "")
                except Exception as e:
                    await _say(on_progress, f"Agent enrichment skipped: {str(e)[:80]}")
        else:
            await _say(on_progress, "No registry record found")
    if res["found"] and not res["negative"]:
        _mca_cache[key] = (time.time(), res)
    return {**res, "cached": False}


# ---------------- 2. HIRING HEALTH: job boards + layoff news ----------------
async def check_linkedin(company: str, on_progress: Progress = None) -> dict:
    if DEMO:
        await _fake(on_progress, ["Searching job boards", "Checking layoff news"])
        s = _seed(company, "li")
        ghost = "ghost" in company.lower()
        return {"data_available": True, "job_pages": 0 if ghost else 2 + s % 4, "openings_listed": 0 if ghost else 20 + s % 400,
                "layoff_news": [{"title": f"{company} announces job cuts", "url": "https://example.com/news", "date": ""}] if s % 5 == 0 else [],
                "job_sources": []}
    after = (date.today() - timedelta(days=365)).isoformat()
    await _say(on_progress, "Searching job boards and layoff news")
    news, jobs = await asyncio.gather(
        search(f'"{company}" layoffs job cuts', news=True, after=after),
        search(f"{company} jobs openings careers", include=JOB_SITES))
    layoffs = [{"title": r.get("title", ""), "url": r.get("url", ""), "date": r.get("date", "")} for r in news
               if mentions(company, r.get("title", "")) and LAYOFF_RE.search(f"{r.get('title','')} {r.get('snippet','')}")][:5]
    pages, openings, srcs = 0, 0, []
    for r in jobs:
        text = f"{r.get('title','')} {r.get('snippet','')}"
        if not mentions(company, text): continue
        pages += 1; srcs.append(r.get("url", ""))
        for n in re.findall(r"(\d[\d,]*)\+?\s*(?:open\s+)?(?:jobs|job openings|openings|vacancies|positions)", text, re.I):
            openings = max(openings, int(n.replace(",", "")))
    await _say(on_progress, f"{pages} job-board pages, {len(layoffs)} layoff news items")
    return {"data_available": True, "job_pages": pages, "openings_listed": openings, "layoff_news": layoffs, "job_sources": srcs[:5]}


# ---------------- 3. CULTURE: community threads via Search ----------------
async def check_reddit(company: str, on_progress: Progress = None) -> dict:
    if DEMO:
        await _fake(on_progress, ["Searching Reddit threads", "Collecting comment text"])
        s = _seed(company, "rd")
        pool = ["good mentors and learning", "salary delayed again, very toxic management", "they made us sign a bond",
                "unpaid internship for 3 months", "decent wlb, chill team", "great stipend and flexible hours",
                "sudden layoffs last quarter"]
        return {"comments": [pool[(s >> i) % len(pool)] for i in range(0, 20, 3)], "sources": []}
    await _say(on_progress, "Searching Reddit and developer forums")
    a, b = await asyncio.gather(
        search(f'"{company}" work culture review salary', include=["reddit.com"]),
        search(f'"{company}" internship stipend bond toxic unpaid layoffs', include=["reddit.com", "teamblind.com", "quora.com"]))
    seen, comments, sources = set(), [], []
    for r in a + b:
        text = f"{r.get('title','')}. {r.get('snippet','')}".strip()
        if r.get("url") in seen or not mentions(company, text): continue
        seen.add(r.get("url")); comments.append(text); sources.append({"title": r.get("title", ""), "url": r.get("url", "")})
    await _say(on_progress, f"Read {len(comments)} relevant community posts")
    return {"comments": comments[:15], "sources": sources[:8]}