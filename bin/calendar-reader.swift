// Local calendar reader (t785): reads what macOS Calendar shows (iCloud, Google, Exchange) through EventKit. Read-only.
// calendar-reader status | allow | calendars | events [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--calendar <name>] [--notes]
// Location and notes are written by whoever sent the invite (t925): left out unless --notes, then under "untrusted".
// Prints JSON. Only `allow` asks for access; everything else fails with a clear error instead of prompting.
import EventKit
import Foundation

let store = EKEventStore()
let iso = ISO8601DateFormatter()
iso.formatOptions = [.withInternetDateTime]

func out(_ v: Any) {
  let d = try! JSONSerialization.data(withJSONObject: v, options: [.prettyPrinted, .sortedKeys])
  FileHandle.standardOutput.write(d); print()
}
func fail(_ msg: String, _ code: Int32 = 1) -> Never {
  FileHandle.standardError.write(try! JSONSerialization.data(withJSONObject: ["error": msg]) + Data("\n".utf8))
  exit(code)
}

func status() -> String {
  switch EKEventStore.authorizationStatus(for: .event) {
  case .fullAccess: return "allowed"
  case .writeOnly: return "write-only"
  case .denied: return "denied"
  case .restricted: return "restricted"
  case .notDetermined: return "not asked"
  @unknown default: return "unknown"
  }
}
func requireAccess() {
  let s = status()
  if s == "allowed" { return }
  if s == "not asked" { fail("No calendar access yet. Run `agents.mjs calendar allow` once and accept the prompt.", 2) }
  fail("Calendar access is \(s). Allow it in System Settings, Privacy & Security, Calendars.", 2)
}

func day(_ s: String) -> Date {
  let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; f.timeZone = .current; f.locale = Locale(identifier: "en_US_POSIX")
  guard let d = f.date(from: s) else { fail("Dates are YYYY-MM-DD, got \(s)") }
  return d
}
func calInfo(_ c: EKCalendar) -> [String: Any] {
  ["id": c.calendarIdentifier, "title": c.title, "source": c.source.title, "type": ["local", "caldav", "exchange", "subscription", "birthday"][min(c.type.rawValue, 4)]]
}

var args = Array(CommandLine.arguments.dropFirst())
let cmd = args.isEmpty ? "events" : args.removeFirst()
func opt(_ name: String) -> String? {
  guard let i = args.firstIndex(of: name) else { return nil }
  guard i + 1 < args.count else { fail("\(name) needs a value") }
  return args[i + 1]
}

switch cmd {
case "status":
  out(["status": status()])
case "allow":
  let sem = DispatchSemaphore(value: 0); var ok = false, err: Error?
  store.requestFullAccessToEvents { g, e in ok = g; err = e; sem.signal() }
  if sem.wait(timeout: .now() + 120) == .timedOut { fail("No answer to the calendar prompt within 2 minutes.", 2) }
  if let err = err { fail("Calendar access request failed: \(err.localizedDescription)", 2) }
  if !ok { fail("Calendar access denied. Allow it in System Settings, Privacy & Security, Calendars.", 2) }
  out(["status": status()])
case "calendars":
  requireAccess()
  out(store.calendars(for: .event).map(calInfo))
case "events":
  let start = opt("--from").map(day) ?? Calendar.current.startOfDay(for: Date())
  let toDay = opt("--to").map(day) ?? start
  let end = Calendar.current.date(byAdding: .day, value: 1, to: toDay)!  // --to is inclusive
  if end <= start { fail("--to is before --from") }
  if end.timeIntervalSince(start) > 366 * 86400 { fail("At most a year at a time") }
  requireAccess()
  var cals = store.calendars(for: .event)
  if let name = opt("--calendar") {
    cals = cals.filter { $0.title.caseInsensitiveCompare(name) == .orderedSame || $0.calendarIdentifier == name }
    if cals.isEmpty { fail("No calendar named \(name). See `agents.mjs calendar list`.") }
  }
  let notes = args.contains("--notes")
  func who(_ p: EKParticipant) -> String { p.name ?? p.url.absoluteString.replacingOccurrences(of: "mailto:", with: "") }
  let evs = store.events(matching: store.predicateForEvents(withStart: start, end: end, calendars: cals))
    .sorted { $0.startDate < $1.startDate }
  out([
    "from": iso.string(from: start), "to": iso.string(from: end),
    "calendars": cals.map(calInfo),
    "events": evs.map { e -> [String: Any] in
      var r: [String: Any] = ["title": e.title ?? "", "start": iso.string(from: e.startDate), "end": iso.string(from: e.endDate), "allDay": e.isAllDay,
       "calendar": e.calendar.title, "calendarId": e.calendar.calendarIdentifier, "attendees": (e.attendees ?? []).map(who)]
      if notes { r["untrusted"] = ["location": e.location ?? "", "notes": String((e.notes ?? "").prefix(4000))] }
      return r
    },
  ])
default:
  fail("usage: calendar-reader status | allow | calendars | events [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--calendar <name>] [--notes]")
}
