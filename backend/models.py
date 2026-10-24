from pydantic import BaseModel
from typing import List, Optional

class JobRequest(BaseModel):
    job_url: str
    company_name: Optional[str] = "Auto-detected"

class RawExtraction(BaseModel):
    mca_verified: bool
    linkedin_hires: int
    linkedin_openings: int
    reddit_flags: List[str]

class RealityScore(BaseModel):
    s_legal: float
    s_velocity: float
    s_sentiment: float
    total_score: float

class JobResponse(BaseModel):
    company_name: str
    job_url: str
    status: str
    raw_extraction: RawExtraction
    reality_score: RealityScore