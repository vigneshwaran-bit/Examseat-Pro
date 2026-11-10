from datetime import datetime, timezone
import json
import uuid
import os

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from supabase import Client, create_client

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
    raise RuntimeError("Supabase environment variables are missing.")

supabase: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)


class Student(BaseModel):
    id: str = Field(min_length=1)
    registerNo: str = Field(min_length=1)
    name: str = Field(min_length=1)
    department: str = Field(min_length=1)
    year: str = Field(min_length=1)
    section: str = Field(min_length=1)


class ExamDetails(BaseModel):
    department: str = Field(min_length=1)
    year: str = Field(min_length=1)
    section: str = Field(min_length=1)
    examName: str = Field(min_length=1)
    examDate: str = Field(min_length=1)
    examTiming: str = Field(min_length=1)
    session: str = Field(min_length=1)


class AllocationRequest(BaseModel):
    students: list[Student]
    exam: ExamDetails


app = FastAPI(title="ExamSeat Pro API", version="0.3.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5500",
        "http://127.0.0.1:5500",
        "http://localhost:8000",
        "http://127.0.0.1:8000",
    ],
    allow_origin_regex=r"https?://(localhost|127\.0\.0\.1)(:\d+)?",
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)

ROMAN_YEARS = {"I": 1, "II": 2, "III": 3, "IV": 4, "V": 5}
HALL_DISPLAY_NAMES = {
    "HALL-01": "IST-101",
    "HALL-02": "IST-102",
    "HALL-03": "IST-103",
    "HALL-04": "IST-104",
}


def year_number(value: str) -> int:
    normalized = str(value).strip().upper()
    number = ROMAN_YEARS.get(normalized)
    if number is None:
        try:
            number = int(normalized)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=f"Invalid year: {value}") from exc
    if number not in range(1, 6):
        raise HTTPException(status_code=422, detail=f"Invalid year: {value}")
    return number


def exam_identity(exam: ExamDetails) -> tuple[str, dict]:
    try:
        exam_date = datetime.strptime(
            exam.examDate, "%Y-%m-%d"
        ).date().isoformat()
    except ValueError as exc:
        raise HTTPException(
            status_code=422,
            detail="Enter a valid exam date.",
        ) from exc

    exam_time = exam.examTiming.strip()
    if not exam_time:
        raise HTTPException(
            status_code=422,
            detail="Enter the exam timing.",
        )

    values = {
        "exam_name": exam.examName.strip(),
        "department": exam.department.strip(),
        "year": year_number(exam.year),
        "section": exam.section.strip(),
        "exam_date": exam_date,
        "exam_time": exam_time,
        "session": exam.session.strip().upper(),
    }
    # Department, year, and section describe a student cohort, not the exam
    # sitting. Keep the exam ID stable when another cohort is added later.
    identity_values = [
        values["exam_name"].casefold(),
        values["exam_date"],
        values["exam_time"].casefold(),
        values["session"].casefold(),
    ]
    identity = json.dumps(identity_values, ensure_ascii=False, separators=(",", ":"))
    exam_id = str(uuid.uuid5(uuid.NAMESPACE_URL, f"examseat-pro:{identity}"))
    return exam_id, values


def legacy_exam_id(exam_values: dict) -> str:
    """Return the pre-cohort-reallocation ID for existing saved allocations."""
    identity_values = [
        value.casefold() if isinstance(value, str) else value
        for value in exam_values.values()
    ]
    identity = json.dumps(identity_values, ensure_ascii=False, separators=(",", ":"))
    return str(uuid.uuid5(uuid.NAMESPACE_URL, f"examseat-pro:{identity}"))


def cohort_key(student: dict) -> tuple[str, int, str]:
    return (
        str(student.get("department") or "").strip().casefold(),
        year_number(str(student.get("year") or "")),
        str(student.get("section") or "").strip().casefold(),
    )


def plan_seat_assignments(students: list[dict], halls: list[dict], reserved_slots: set[tuple]) -> dict:
    """Place each cohort in one seat position per bench, continuing hall by hall."""
    cohorts = {}
    for student in students:
        cohorts.setdefault(cohort_key(student), []).append(student)
    for cohort in cohorts.values():
        cohort.sort(key=lambda student: str(student["register_number"]).casefold())

    physical_slots = []
    lane_slots = {}
    for seat_number in range(1, max(hall["students_per_bench"] for hall in halls) + 1):
        lane_slots[seat_number] = []
        for hall in halls:
            if seat_number > hall["students_per_bench"]:
                continue
            for row_number in range(1, hall["rows_count"] + 1):
                for bench_number in range(1, hall["benches_per_row"] + 1):
                    lane_slots[seat_number].append(
                        (hall, row_number, bench_number, seat_number)
                    )
    for hall in halls:
        for row_number in range(1, hall["rows_count"] + 1):
            for bench_number in range(1, hall["benches_per_row"] + 1):
                for seat_number in range(1, hall["students_per_bench"] + 1):
                    physical_slots.append((hall, row_number, bench_number, seat_number))

    used = set(reserved_slots)
    assignments = {}
    available_physical = [
        slot for slot in physical_slots
        if (slot[0]["id"], slot[1], slot[2], slot[3]) not in used
    ]
    cohort_count = max(1, max(hall["students_per_bench"] for hall in halls))

    for index, cohort_students in enumerate(cohorts.values()):
        preferred_seat = index + 1 if index < cohort_count else None
        preferred = [
            slot for slot in lane_slots.get(preferred_seat, [])
            if (slot[0]["id"], slot[1], slot[2], slot[3]) not in used
        ] if preferred_seat is not None else []
        count = min(len(cohort_students), len(preferred))
        chosen = preferred[:count]
        remaining = cohort_students[count:]
        if remaining:
            fallback = [
                slot for slot in available_physical
                if (slot[0]["id"], slot[1], slot[2], slot[3]) not in used
                and slot not in chosen
            ]
            if len(remaining) > len(fallback):
                raise HTTPException(status_code=422, detail="There are more students than available seats.")
            chosen.extend(fallback[:len(remaining)])
        for student, (hall, row_number, bench_number, seat_number) in zip(cohort_students, chosen):
            slot = (hall["id"], row_number, bench_number, seat_number)
            assignments[student["id"]] = slot
            used.add(slot)

    if len(assignments) != len(students):
        raise HTTPException(status_code=422, detail="There are more students than available seats.")
    return assignments


@app.get("/api/health")
def health():
    return {
        "status": "ok",
        "service": "examseat-pro-api",
        "allocationStrategy": "cohort-seat-lanes",
    }


@app.post("/api/allocations")
def create_allocation(request: AllocationRequest):
    register_numbers = [student.registerNo.strip().casefold() for student in request.students]
    if any(not register_number for register_number in register_numbers):
        raise HTTPException(status_code=422, detail="Register numbers cannot be empty.")
    if len(register_numbers) != len(set(register_numbers)):
        raise HTTPException(status_code=422, detail="Register numbers must be unique.")

    exam_id, exam_values = exam_identity(request.exam)
    try:
        # Reuse an existing exam row for the same sitting, even when the
        # incoming students belong to a different department/year/section.
        matching_exams_result = supabase.table("exams").select(
            "id,exam_name,exam_date,exam_time,session"
        ).eq("exam_date", exam_values["exam_date"]).execute()
        # Cohorts sometimes enter the same sitting with different capitalization
        # or spacing. Reuse its existing exam row so later cohorts continue in
        # the same allocation instead of starting a second set of seats.
        canonical = lambda value: " ".join(str(value or "").split()).casefold()
        matching_exam_rows = [
            row for row in (matching_exams_result.data or [])
            if canonical(row.get("exam_name")) == canonical(exam_values["exam_name"])
            and canonical(row.get("exam_time")) == canonical(exam_values["exam_time"])
            and canonical(row.get("session")) == canonical(exam_values["session"])
        ]
        matching_exam_ids = list({row["id"] for row in matching_exam_rows})

        allocated_exam_ids = set()
        if matching_exam_ids:
            matching_allocations_result = supabase.table("seat_allocations").select(
                "exam_id"
            ).in_("exam_id", matching_exam_ids).execute()
            allocated_exam_ids = {
                row["exam_id"] for row in (matching_allocations_result.data or [])
            }

        if len(allocated_exam_ids) > 1:
            raise HTTPException(
                status_code=409,
                detail=(
                    "This exam already has allocations under multiple records. "
                    "Resolve those existing allocations before adding another department."
                ),
            )

        if allocated_exam_ids:
            exam_id = next(iter(allocated_exam_ids))
        elif len(matching_exam_ids) == 1:
            exam_id = matching_exam_ids[0]
        else:
            old_id = legacy_exam_id(exam_values)
            exam_id = old_id if old_id in matching_exam_ids else exam_id

        if exam_id not in matching_exam_ids:
            # Store the initial cohort metadata only once; later cohorts must
            # not overwrite the exam's identifying row.
            supabase.table("exams").upsert(
                {"id": exam_id, **exam_values}, on_conflict="id"
            ).execute()

        student_rows = [
            {
                "register_number": student.registerNo.strip(),
                "name": student.name.strip(),
                "department": student.department.strip(),
                "year": year_number(student.year),
                "section": student.section.strip(),
            }
            for student in request.students
        ]
        if student_rows:
            # The unique register_number index preserves existing student IDs;
            # the database generates IDs for students imported for the first time.
            supabase.table("students").upsert(
                student_rows, on_conflict="register_number"
            ).execute()

        halls_result = supabase.table("halls").select(
            "id,hall_code,hall_name,capacity,rows_count,benches_per_row,students_per_bench"
        ).order("hall_code").execute()
        db_halls = halls_result.data or []
        if not db_halls:
            raise HTTPException(status_code=503, detail="No halls are configured in the database.")

        if request.students:
            students_result = supabase.table("students").select(
                "id,register_number"
            ).in_("register_number", [student.registerNo.strip() for student in request.students]).execute()
            student_by_register = {
                row["register_number"].casefold(): row["id"]
                for row in (students_result.data or [])
            }
        else:
            student_by_register = {}

        current_result = supabase.table("seat_allocations").select(
            "id,student_id,hall_id,row_number,bench_number,seat_number,created_at,status"
        ).eq("exam_id", exam_id).execute()
        current_rows = current_result.data or []
        active_rows = [row for row in current_rows if row.get("status") == "active"]
        inactive_rows = [row for row in current_rows if row.get("status") != "active"]
        assigned_student_ids = {row["student_id"] for row in current_rows}

        all_slots = [
            (hall, row_number, bench_number, seat_number)
            for hall in db_halls
            for row_number in range(1, hall["rows_count"] + 1)
            for bench_number in range(1, hall["benches_per_row"] + 1)
            for seat_number in range(1, hall["students_per_bench"] + 1)
        ]
        if len(all_slots) < len(current_rows):
            raise HTTPException(status_code=409, detail="Saved allocations exceed the configured hall capacity.")

        unassigned = sorted(
            (
                student for student in request.students
                if student_by_register.get(student.registerNo.strip().casefold()) not in assigned_student_ids
            ),
            key=lambda student: student.registerNo.strip().casefold(),
        )
        all_student_ids = list({
            row["student_id"] for row in active_rows
        } | {
            student_by_register[student.registerNo.strip().casefold()]
            for student in request.students
            if student.registerNo.strip().casefold() in student_by_register
        })
        saved_student_by_id = {}
        if all_student_ids:
            saved_student_result = supabase.table("students").select(
                "id,register_number,name,department,year,section"
            ).in_("id", all_student_ids).execute()
            saved_student_by_id = {
                student["id"]: student
                for student in (saved_student_result.data or [])
            }

        ordered_students = []
        seen_student_ids = set()
        for row in sorted(active_rows, key=lambda item: (item.get("created_at", ""), item["id"])):
            student = saved_student_by_id.get(row["student_id"])
            if not student:
                raise HTTPException(status_code=409, detail="A saved student record is missing; resolve it before reallocating seats.")
            ordered_students.append(student)
            seen_student_ids.add(student["id"])
        for student in unassigned:
            student_id = student_by_register.get(student.registerNo.strip().casefold())
            if not student_id:
                raise HTTPException(status_code=500, detail="A student record could not be loaded after saving.")
            if student_id in seen_student_ids:
                continue
            saved_student = saved_student_by_id.get(student_id)
            if not saved_student:
                raise HTTPException(status_code=500, detail="A student record could not be loaded after saving.")
            ordered_students.append(saved_student)
            seen_student_ids.add(student_id)

        reserved_slots = {
            (row["hall_id"], row["row_number"], row["bench_number"], row["seat_number"])
            for row in inactive_rows
        }
        if len(ordered_students) + len(inactive_rows) > len(all_slots):
            raise HTTPException(status_code=422, detail="There are more students than available seats.")

        planned_slots = plan_seat_assignments(ordered_students, db_halls, reserved_slots)
        existing_allocation_id = {
            row["student_id"]: row["id"] for row in active_rows
        }
        new_allocations = []
        for student in ordered_students:
            if student["id"] not in existing_allocation_id:
                new_allocations.append({
                    "id": str(uuid.uuid4()),
                    "student_id": student["id"],
                })
                existing_allocation_id[student["id"]] = new_allocations[-1]["id"]

        assignments = []
        hall_ids = {str(hall["id"]): hall["id"] for hall in db_halls}
        for student in ordered_students:
            hall_id, row_number, bench_number, seat_number = planned_slots[student["id"]]
            assignments.append({
                "id": existing_allocation_id[student["id"]],
                "hall_id": hall_ids[str(hall_id)],
                "row_number": row_number,
                "bench_number": bench_number,
                "seat_number": seat_number,
            })

        if active_rows or new_allocations:
            try:
                supabase.rpc("apply_exam_seat_layout", {
                    "p_exam_id": exam_id,
                    "p_new_allocations": new_allocations,
                    "p_assignments": assignments,
                }).execute()
            except Exception as exc:
                raise HTTPException(
                    status_code=409,
                    detail="The seating layout could not be updated safely. Check that the database migration is installed and retry.",
                ) from exc

        saved_result = supabase.table("seat_allocations").select(
            "student_id,hall_id,row_number,bench_number,seat_number,status"
        ).eq("exam_id", exam_id).execute()
        saved_rows = saved_result.data or []
        saved_student_ids = list({row["student_id"] for row in saved_rows})
        saved_student_by_id = {}
        if saved_student_ids:
            saved_student_result = supabase.table("students").select(
                "id,register_number,name,department,year,section"
            ).in_("id", saved_student_ids).execute()
            saved_student_by_id = {
                student["id"]: student
                for student in (saved_student_result.data or [])
            }

        saved_slots = {
            (row["hall_id"], row["row_number"], row["bench_number"], row["seat_number"])
            for row in saved_rows
        }
        hall_by_id = {hall["id"]: hall for hall in db_halls}
        hall_counts = {hall["id"]: 0 for hall in db_halls}
        seats = []
        for row in saved_rows:
            hall = hall_by_id.get(row["hall_id"])
            if hall is None:
                continue
            hall_counts[hall["id"]] += 1
            student = saved_student_by_id.get(row["student_id"])
            seats.append({
                "hallId": hall["hall_code"],
                "row": row["row_number"],
                "bench": row["bench_number"],
                "seat": row["seat_number"],
                "studentId": student["id"] if student else None,
                "registerNo": student["register_number"] if student else None,
                "name": student["name"] if student else None,
                "department": student["department"] if student else None,
                "year": student["year"] if student else None,
                "section": student["section"] if student else None,
            })
        for hall, row_number, bench_number, seat_number in all_slots:
            if (hall["id"], row_number, bench_number, seat_number) not in saved_slots:
                seats.append({
                    "hallId": hall["hall_code"],
                    "row": row_number,
                    "bench": bench_number,
                    "seat": seat_number,
                    "studentId": None,
                })
        seats.sort(key=lambda seat: (seat["hallId"], seat["row"], seat["bench"], seat["seat"]))

        halls = []
        for hall in db_halls:
            capacity = hall["capacity"]
            allocated = hall_counts[hall["id"]]
            halls.append({
                "id": hall["hall_code"],
                "name": HALL_DISPLAY_NAMES.get(hall["hall_code"], hall["hall_name"]),
                "capacity": capacity,
                "allocated": allocated,
                "empty": capacity - allocated,
                "status": "EMPTY" if allocated == 0 else "FULL" if allocated >= capacity else "PARTIALLY FILLED",
            })

        return {
            "examId": exam_id,
            "seats": seats,
            "halls": halls,
            "createdAt": datetime.now(timezone.utc).isoformat(),
        }
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail="Could not save this allocation. Check the backend database connection and try again.",
        ) from exc
