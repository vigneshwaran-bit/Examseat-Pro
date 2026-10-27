# ExamSeat Pro backend

This is the first backend slice: FastAPI owns seat allocation while the existing browser UI continues to render the same `{ seats, halls, createdAt }` result shape.

## Run locally

From the project directory, install the backend dependencies and start the API:

```powershell
py -m pip install -r backend/requirements.txt

```py -m uvicorn app.main:app --app-dir backend --reload

Serve the existing `index.html` with a local static server on `localhost` or `127.0.0.1` (port 5500 is allowed by the development CORS settings), then open the page. The browser calls `http://127.0.0.1:8000/api/allocations` when **Allocate Seats** is clicked.

The API currently accepts the student records already held by the frontend. Google Sheet/Excel ingestion, Supabase authentication and persistence, and the Java component are not connected in this first slice.
