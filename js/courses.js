const coursesEl = $("[data-courses]");

async function loadCourses() {
  const res = await fetch("/api/courses", { credentials: "same-origin" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

loadCourses().then((courses) => {
  if (courses.length) {
    coursesEl.className = "grid";
    coursesEl.innerHTML = courses.map((c) => courseCard({ name: c.title, code: c.courseId, desc: c.description, href: `course.html?id=${encodeURIComponent(c.courseId)}` })).join("");
  } else {
    coursesEl.innerHTML = emptyState("Courses will appear here soon.", "We are preparing the course catalogue. Please check back shortly.");
  }
}).catch(() => {
  coursesEl.innerHTML = emptyState("We couldn't load the courses", "Please refresh the page to try again.");
}).finally(() => setupReveal());
