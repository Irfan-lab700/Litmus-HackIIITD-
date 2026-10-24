
# HACKIIITD

Hackathon project built during the 24-hour HACKIIITD hackathon.

## Tech Stack
- React
- TypeScript
- Vite
- Tailwind CSS
- Python
- FastAPI
- Tiny Fish API

## Project Structure
- `frontend/` — Web application
- `backend/` — API server

## Run Locally

### Frontend
```bash
cd frontend
npm install
npm run dev
```

### Backend
```bash
cd backend
python -m venv venv
```

Activate the virtual environment, then:

```bash
pip install -r requirements.txt
uvicorn main:app --reload
```

API documentation: http://127.0.0.1:8000/docs
