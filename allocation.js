const AllocationEngine = {
  emptyHall(hallId) {
    const seats = [];
    for (let row = 1; row <= CONFIG.ROWS; row += 1) {
      for (let bench = 1; bench <= CONFIG.COLS; bench += 1) {
        for (let seat = 1; seat <= CONFIG.SEATS_PER_BENCH; seat += 1) {
          seats.push({ hallId, row, bench, seat, studentId: null });
        }
      }
    }
    return seats;
  },

  /**
   * Frontend demonstration allotment.
   * Fills halls in order (A-101, A-102, A-103).
   * Later a backend can return the same { seats[], halls[] } shape.
   */
  allocate(students) {
    const pool = students.slice().sort((a, b) => a.registerNo.localeCompare(b.registerNo));
    const seats = [];
    const halls = CONFIG.HALLS.map((hall) => {
      const hallSeats = this.emptyHall(hall.id);
      hallSeats.forEach((cell) => {
        const student = pool.shift();
        cell.studentId = student ? student.id : null;
      });
      seats.push(...hallSeats);
      const allocated = hallSeats.filter((s) => s.studentId).length;
      return {
        id: hall.id,
        name: hall.name,
        capacity: hall.capacity,
        allocated,
        empty: hall.capacity - allocated,
        status: UI.hallStatus(allocated, hall.capacity)
      };
    });

    return {
      seats,
      halls,
      createdAt: new Date().toISOString()
    };
  }
};
