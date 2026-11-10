-- Rebalance one exam without deleting student allocation records.
-- New rows and all active seat moves commit or roll back as one transaction.
CREATE OR REPLACE FUNCTION public.apply_exam_seat_layout(
    p_exam_id uuid,
    p_new_allocations jsonb,
    p_assignments jsonb
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_max_row integer;
    v_offset integer;
    v_hall_id uuid;
    v_expected integer;
    v_payload integer;
    v_updated integer;
    v_now timestamptz := clock_timestamp();
BEGIN
    PERFORM pg_advisory_xact_lock(hashtextextended(p_exam_id::text, 0));

    IF jsonb_typeof(p_new_allocations) <> 'array'
       OR jsonb_typeof(p_assignments) <> 'array' THEN
        RAISE EXCEPTION 'Allocation payloads must be JSON arrays';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM jsonb_to_recordset(p_new_allocations) AS n(id uuid, student_id uuid)
        GROUP BY n.id HAVING count(*) > 1
    ) OR EXISTS (
        SELECT 1
        FROM jsonb_to_recordset(p_new_allocations) AS n(id uuid, student_id uuid)
        GROUP BY n.student_id HAVING count(*) > 1
    ) THEN
        RAISE EXCEPTION 'New allocation identifiers must be unique';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM jsonb_to_recordset(p_new_allocations) AS n(id uuid, student_id uuid)
        JOIN seat_allocations sa
          ON sa.exam_id = p_exam_id AND sa.student_id = n.student_id
    ) THEN
        RAISE EXCEPTION 'A student already has an allocation for this exam';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM jsonb_to_recordset(p_new_allocations) AS n(id uuid, student_id uuid)
        LEFT JOIN students s ON s.id = n.student_id
        WHERE n.id IS NULL OR n.student_id IS NULL OR s.id IS NULL
    ) THEN
        RAISE EXCEPTION 'New allocation references an invalid student';
    END IF;

    SELECT coalesce(max(row_number), 0)
      INTO v_max_row
      FROM seat_allocations
     WHERE exam_id = p_exam_id;
    v_offset := v_max_row + 1000000;

    IF v_offset + v_max_row + jsonb_array_length(p_new_allocations) > 2147483647 THEN
        RAISE EXCEPTION 'Allocation is too large to stage safely';
    END IF;

    -- Move current active rows to a positive, non-overlapping temporary range.
    -- The coordinate checks only require positive values; final coordinates
    -- are validated below before this transaction can commit.
    UPDATE seat_allocations
       SET row_number = row_number + v_offset
     WHERE exam_id = p_exam_id AND status = 'active';

    SELECT id INTO v_hall_id FROM halls ORDER BY hall_code LIMIT 1;
    IF v_hall_id IS NULL AND jsonb_array_length(p_new_allocations) > 0 THEN
        RAISE EXCEPTION 'No hall is configured';
    END IF;

    INSERT INTO seat_allocations (
        id, exam_id, student_id, hall_id, row_number, bench_number,
        seat_number, created_at, status, archived_at
    )
    SELECT (n.item ->> 'id')::uuid, p_exam_id, (n.item ->> 'student_id')::uuid, v_hall_id,
           v_offset + v_max_row + n.ordinality::integer,
           1, 1,
           v_now + (n.ordinality - 1) * interval '1 microsecond',
           'active', NULL
      FROM jsonb_array_elements(p_new_allocations) WITH ORDINALITY
           AS n(item, ordinality);

    SELECT count(*) INTO v_expected
      FROM seat_allocations
     WHERE exam_id = p_exam_id AND status = 'active';
    SELECT count(*) INTO v_payload
      FROM jsonb_to_recordset(p_assignments)
           AS a(id uuid, hall_id uuid, row_number integer, bench_number integer, seat_number integer);

    IF v_expected <> v_payload THEN
        RAISE EXCEPTION 'Seating changed while the allocation was being prepared';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM jsonb_to_recordset(p_assignments)
             AS a(id uuid, hall_id uuid, row_number integer, bench_number integer, seat_number integer)
        GROUP BY a.id HAVING count(*) > 1
    ) OR EXISTS (
        SELECT 1
        FROM jsonb_to_recordset(p_assignments)
             AS a(id uuid, hall_id uuid, row_number integer, bench_number integer, seat_number integer)
        GROUP BY a.hall_id, a.row_number, a.bench_number, a.seat_number HAVING count(*) > 1
    ) THEN
        RAISE EXCEPTION 'The seating plan contains duplicate students or seats';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM jsonb_to_recordset(p_assignments)
             AS a(id uuid, hall_id uuid, row_number integer, bench_number integer, seat_number integer)
        LEFT JOIN seat_allocations sa
          ON sa.id = a.id AND sa.exam_id = p_exam_id AND sa.status = 'active'
        LEFT JOIN halls h ON h.id = a.hall_id
        WHERE sa.id IS NULL OR h.id IS NULL
           OR a.row_number < 1 OR a.row_number > h.rows_count
           OR a.bench_number < 1 OR a.bench_number > h.benches_per_row
           OR a.seat_number < 1 OR a.seat_number > h.students_per_bench
    ) THEN
        RAISE EXCEPTION 'The seating plan contains an invalid row, bench, or seat';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM jsonb_to_recordset(p_assignments)
             AS a(id uuid, hall_id uuid, row_number integer, bench_number integer, seat_number integer)
        JOIN seat_allocations archived
          ON archived.exam_id = p_exam_id
         AND archived.status <> 'active'
         AND archived.hall_id = a.hall_id
         AND archived.row_number = a.row_number
         AND archived.bench_number = a.bench_number
         AND archived.seat_number = a.seat_number
    ) THEN
        RAISE EXCEPTION 'The seating plan conflicts with an archived allocation';
    END IF;

    UPDATE seat_allocations sa
       SET hall_id = a.hall_id,
           row_number = a.row_number,
           bench_number = a.bench_number,
           seat_number = a.seat_number
      FROM jsonb_to_recordset(p_assignments)
           AS a(id uuid, hall_id uuid, row_number integer, bench_number integer, seat_number integer)
     WHERE sa.id = a.id AND sa.exam_id = p_exam_id AND sa.status = 'active';
    GET DIAGNOSTICS v_updated = ROW_COUNT;

    IF v_updated <> v_expected THEN
        RAISE EXCEPTION 'Not all active allocations were updated';
    END IF;

    RETURN v_updated;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_exam_seat_layout(uuid, jsonb, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_exam_seat_layout(uuid, jsonb, jsonb) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_exam_seat_layout(uuid, jsonb, jsonb) TO service_role;
