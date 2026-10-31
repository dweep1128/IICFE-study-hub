// Tab name -> header row. Single source of truth for seed.js and check-db.js.
// New columns are only ever appended, so existing sheets can be upgraded in place.
module.exports = {
  TABS: {
    Students: ["studentId", "name", "email", "password", "status", "joinedOn"],
    Courses: ["courseId", "title", "description", "status", "totalLessons", "hoursTotal", "bannerQuote"],
    Enrollments: ["enrollmentId", "studentId", "courseId", "status", "progressPct", "enrolledOn", "completedOn"],
    Payments: ["paymentId", "studentId", "date", "description", "amount", "status", "receiptUrl"],
    Certificates: ["certId", "studentId", "courseId", "issuedOn", "certUrl"],
    Webinars: ["webinarId", "title", "date", "time", "joinUrl", "status"],
    News: ["newsId", "title", "body", "date"],
    Modules: ["moduleId", "courseId", "title", "order", "hours", "summary"],
    ModuleProgress: ["studentId", "moduleId", "status", "completedOn"],
    Dues: ["dueId", "studentId", "courseId", "title", "type", "dueDate", "priority"],
    Guidance: ["guideId", "courseId", "title", "body", "order"],
    Resources: ["resourceId", "courseId", "moduleId", "type", "title", "url", "durationMin", "content"],
    Highlights: ["highlightId", "studentId", "resourceId", "paragraphIndex", "startOffset", "endOffset", "text", "color", "createdOn", "note"],
    MockTests: ["testId", "courseId", "title", "durationMin", "totalMarks"],
    MockQuestions: ["questionId", "testId", "question", "optionsJson", "correctIndex", "topic", "explanation"],
    MockAttempts: ["attemptId", "studentId", "testId", "score", "total", "timeTakenMin", "topicBreakdownJson", "date"],
    Documents: ["docId", "courseId", "title", "category", "url"],
    Exams: ["examId", "courseId", "title", "date", "time", "mode", "instructions", "status"],
    ChatLogs: ["logId", "studentId", "courseId", "question", "answer", "date"],
    // Founder's Lab. Created once by `npm run setup-lab`, never during a page request.
    // One row per student and journey item: the tick and (for written items) the answer.
    LabChecklist: ["checkKey", "studentId", "itemId", "checked", "answer", "checkedDate"],
    // One row per submission (a pasted https link for now). Every row has a status (submitted / approved / changes_requested) and reviewer fields,
    // so a mentor review page can be added later without changing the data. A resubmission is a new row with version + 1.
    LabSubmissions: ["subId", "studentId", "courseId", "uploadType", "itemId", "itemLabel", "sessionNo", "url", "fileName", "version", "status", "reviewNote", "reviewer", "submittedAt", "reviewedAt"],
    // Competitions: the catalogue is kept by the programme team (active = TRUE publishes a row); entries are the student's own status and star.
    LabCompetitions: ["compId", "name", "org", "about", "eligibility", "eventDate", "deadline", "prize", "url", "active"],
    LabCompetitionEntries: ["entryKey", "studentId", "compId", "status", "saved", "updatedAt"],
    // The session timeline, kept by the programme team. A row overrides the defaults in founders-lab-sessions.json field by field;
    // sessions after the first stay "Coming soon" until visible = TRUE. Activities: "text | time" per line. Output and uploadSlots: one per line.
    // Recap: plain lines, then "- takeaway" lines. quizJson: [{ "q", "options": [4], "answer": 0-3, "explain" }] (up to 10; read by the server only).
    LabSessions: ["sessionNo", "name", "phase", "date", "time", "duration", "visible", "readingUrl", "activities", "instructions", "output", "recap", "quizJson", "uploadSlots"],
    // One row per student, session and part (notes, activities, practice; ticks and quiz for sessions 2 and later).
    LabProgress: ["progressKey", "studentId", "courseId", "sessionId", "part", "stateJson", "updatedAt"],
    // One row per student and session: the Final Exam attempt (server clock, shuffle, draft, result and score slip).
    LabExamAttempts: ["attemptKey", "studentId", "courseId", "sessionId", "name", "grade", "team", "startedAt", "orderJson", "draftJson", "submittedAt", "score", "total", "seconds", "slipLine", "slipCode", "slipTs"],
  },
  LAB_TABS: ["LabProgress", "LabExamAttempts", "LabChecklist", "LabSubmissions", "LabCompetitions", "LabCompetitionEntries", "LabSessions"],
};
