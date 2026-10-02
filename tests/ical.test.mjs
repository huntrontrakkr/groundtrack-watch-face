// A calendar's private link, read on the phone (src/ical.js): the timed
// events in a window, with repeating ones worked out in their own zone's
// wall clock.
import test from 'node:test';
import assert from 'node:assert/strict';
import {calendarEvents} from '../src/ical.js';

const cal=body=>`BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${body.trim().split('\n').join('\r\n')}\r\nEND:VCALENDAR\r\n`;
const event=lines=>`BEGIN:VEVENT\n${lines}\nEND:VEVENT`;
const iso=list=>list.map(e=>`${new Date(e.epoch).toISOString().slice(0,16)} ${e.title}`);
const week={from:Date.parse('2026-10-05T00:00:00Z'),to:Date.parse('2026-10-12T00:00:00Z'),zone:'America/New_York'};

test('timed events in UTC, in a named zone and floating; all-day and cancelled ones left out',()=>{
  const text=cal([
    event('UID:1\nDTSTART:20261006T140000Z\nSUMMARY:Launch window'),
    event('UID:2\nDTSTART;TZID=Europe/Berlin:20261007T093000\nSUMMARY:Stand-up\\, Berlin'),
    event('UID:3\nDTSTART:20261008T180000\nSUMMARY:Dinner'),
    event('UID:4\nDTSTART;VALUE=DATE:20261009\nSUMMARY:Holiday'),
    event('UID:5\nDTSTART:20261009T120000Z\nSTATUS:CANCELLED\nSUMMARY:Called off'),
    event('UID:6\nDTSTART:20261020T120000Z\nSUMMARY:Too far ahead'),
    event('UID:7\nDTSTART;TZID=Eastern Standard Time:20261009T080000\nSUMMARY:A very long title that goes on and on past forty characters')
  ].join('\n'));
  assert.deepEqual(iso(calendarEvents(text,week)),[
    '2026-10-06T14:00 Launch window','2026-10-07T07:30 Stand-up, Berlin','2026-10-08T22:00 Dinner',
    // (A zone the phone does not know is taken for the phone's.)
    '2026-10-09T12:00 A very long title that goes on and on pa']);
});

test('a line folded across two is one line, and a file that is no calendar is refused',()=>{
  const text=cal(event('UID:1\nDTSTART:20261006T140000Z\nSUMMARY:Launch\n  window\\nwith a second line')).replace('Launch\r\n  window','Launch\r\n  window');
  assert.deepEqual(iso(calendarEvents(text,week)),['2026-10-06T14:00 Launch window with a second line']);
  assert.throws(()=>calendarEvents('<html>Sign in</html>',week),/No calendar/);
});

test('repeating events: daily, weekly on chosen days, with exceptions, counts and ends',()=>{
  const text=cal([
    // Every weekday at 09:15 New York time since March (before the clocks changed), but not Wednesday the 7th.
    event('UID:standup\nDTSTART;TZID=America/New_York:20260302T091500\nRRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR\nEXDATE;TZID=America/New_York:20261007T091500\nSUMMARY:Standup'),
    // Every other day, five times in all, from the 3rd: the 3rd, 5th, 7th, 9th, 11th.
    event('UID:pills\nDTSTART:20261003T200000Z\nRRULE:FREQ=DAILY;INTERVAL=2;COUNT=5\nSUMMARY:Pills'),
    // Weekly on Tuesdays until the 6th inclusive.
    event('UID:class\nDTSTART:20260901T170000Z\nRRULE:FREQ=WEEKLY;UNTIL=20261006T235959Z\nSUMMARY:Class'),
    // Thursday's standup moved to 11:00: the changed occurrence stands in for the series' own.
    event('UID:standup\nRECURRENCE-ID;TZID=America/New_York:20261008T091500\nDTSTART;TZID=America/New_York:20261008T110000\nSUMMARY:Standup (late)')
  ].join('\n'));
  assert.deepEqual(iso(calendarEvents(text,week)),[
    '2026-10-05T13:15 Standup','2026-10-05T20:00 Pills','2026-10-06T13:15 Standup','2026-10-06T17:00 Class','2026-10-07T20:00 Pills',
    '2026-10-08T15:00 Standup (late)','2026-10-09T13:15 Standup','2026-10-09T20:00 Pills','2026-10-11T20:00 Pills']);
});

test('a repeating event keeps its hour on the wall across a clock change',()=>{
  const text=cal(event('UID:1\nDTSTART;TZID=America/New_York:20261029T090000\nRRULE:FREQ=DAILY\nSUMMARY:Run'));
  // New York leaves daylight time on 1 November 2026: 09:00 is 13:00 UTC before, 14:00 after.
  assert.deepEqual(iso(calendarEvents(text,{from:Date.parse('2026-10-31T00:00:00Z'),to:Date.parse('2026-11-02T23:00:00Z'),zone:'UTC'})),
    ['2026-10-31T13:00 Run','2026-11-01T14:00 Run','2026-11-02T14:00 Run']);
});

test('monthly and yearly events: the day of the month, the nth weekday, the last one',()=>{
  const text=cal([
    event('UID:rent\nDTSTART:20260115T100000Z\nRRULE:FREQ=MONTHLY\nSUMMARY:Rent'),
    event('UID:board\nDTSTART:20260113T180000Z\nRRULE:FREQ=MONTHLY;BYDAY=2TU\nSUMMARY:Board'),
    event('UID:review\nDTSTART:20260130T160000Z\nRRULE:FREQ=MONTHLY;BYDAY=-1FR\nSUMMARY:Review'),
    event('UID:day31\nDTSTART:20260131T120000Z\nRRULE:FREQ=MONTHLY\nSUMMARY:Thirty-first'),
    event('UID:birthday\nDTSTART:20201020T080000Z\nRRULE:FREQ=YEARLY\nSUMMARY:Birthday')
  ].join('\n'));
  assert.deepEqual(iso(calendarEvents(text,{from:Date.parse('2026-10-01T00:00:00Z'),to:Date.parse('2026-11-30T23:59:00Z'),zone:'UTC'})),[
    '2026-10-13T18:00 Board','2026-10-15T10:00 Rent','2026-10-20T08:00 Birthday','2026-10-30T16:00 Review','2026-10-31T12:00 Thirty-first',
    '2026-11-10T18:00 Board','2026-11-15T10:00 Rent','2026-11-27T16:00 Review']);
});

test('the earliest come first when there are more than the limit',()=>{
  const text=cal(event('UID:1\nDTSTART:20261005T000000Z\nRRULE:FREQ=DAILY\nSUMMARY:Every day'));
  assert.equal(calendarEvents(text,{...week,limit:3}).length,3);
  assert.deepEqual(iso(calendarEvents(text,{...week,limit:3})).map(l=>l.slice(0,10)),['2026-10-05','2026-10-06','2026-10-07']);
});
