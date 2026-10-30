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
  },
};
