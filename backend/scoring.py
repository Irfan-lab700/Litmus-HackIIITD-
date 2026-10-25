"""Reality Score: S_total = S_legal(40) + S_hiring(35) + S_sentiment(25)."""
import re

RISK_TOKENS = ["toxic", "unpaid", "bond", "scam", "delayed", "layoff", "layoffs", "harassment",
               "no stipend", "training fee", "fake", "ghosted", "stipend delay"]
PENALTY, MAX_HITS_PER_TOKEN = 5, 2


def build_report(company: str, raw: dict) -> dict:
    parts: dict = {}
    flags: list[str] = []
    sources: list[dict] = []

    # --- legal (40): binary ---
    L, verified = raw["legal"], None
    if "error" in L:
        parts["legal"] = None
        flags.append("Could not check MCA registration (search unavailable)")
    else:
        verified = bool(L.get("found")) and not L.get("negative")
        parts["legal"] = (40 if verified else 0, 40)
        if L.get("negative"):
            flags.append(f"High-Risk: registry lists the company as {L.get('status')}")
        elif not L.get("found"):
            flags.append("High-Risk: no MCA registry record found (unregistered, or listed under a different name; check spelling)")
        if L.get("source_url"):
            sources.append({"label": f"MCA data: {L.get('cin','')} ({L.get('status','')})", "url": L["source_url"]})

    # --- hiring health (35): public job boards + layoff news ---
    V = raw["velocity"]
    if "error" in V or not V.get("data_available"):
        parts["velocity"] = None
        flags.append("Hiring data unavailable, not counted in score")
    else:
        layoffs = V.get("layoff_news", [])
        s = 35 - 7 * min(len(layoffs), 3)
        if V.get("job_pages", 0) == 0:
            s -= 14
            flags.append("Ghost Job risk: no open roles found on public job boards")
        if layoffs:
            flags.append(f"{len(layoffs)} layoff/job-cut news item(s) in the last 12 months")
        parts["velocity"] = (max(s, 0), 35)
        sources += [{"label": f"News: {n['title'][:70]}", "url": n["url"]} for n in layoffs]
        sources += [{"label": "Job board listing", "url": u} for u in V.get("job_sources", [])[:2]]

    # --- sentiment (25): start at 25, -5 per risk token ---
    S, hits = raw["sentiment"], {}
    if "error" in S:
        parts["sentiment"] = None
        flags.append("Community check unavailable, not counted in score")
    else:
        text = " ".join(S.get("comments", [])).lower()
        for t in RISK_TOKENS:
            n = len(re.findall(rf"\b{re.escape(t)}\b", text))
            if n: hits[t] = min(n, MAX_HITS_PER_TOKEN)
        parts["sentiment"] = (max(25 - PENALTY * sum(hits.values()), 0), 25)
        flags += [f"Community mentions '{t}'" for t in hits]
        if not S.get("comments"):
            flags.append("No community discussion found")
        sources += [{"label": f"Thread: {x['title'][:70]}", "url": x["url"]} for x in S.get("sources", [])[:4]]

    avail = [p for p in parts.values() if p]
    total = 0 if verified is False else (round(100 * sum(s for s, _ in avail) / sum(m for _, m in avail)) if avail else 0)
    verdict = "High Risk" if total < 40 else "Caution" if total < 70 else "Looks Legit"
    return {"company": company, "total": total, "verdict": verdict, "flags": flags,
            "sources": [s for s in sources if s["url"]],
            "breakdown": {k: ({"score": v[0], "max": v[1]} if v else None) for k, v in parts.items()},
            "details": {"legal": L, "velocity": V, "sentiment": {"risk_hits": hits, "posts_read": len(S.get("comments", []))}}}