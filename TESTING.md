# Portfolio Ops — Acceptance Test Plan

For an independent tester. No knowledge of the codebase is needed.

Every case below states **exactly what to do** and **exactly what should
happen**. If what you see differs from the "Expected" column, that is a defect —
record the case number, what you saw, and which account you were signed in as.

**Rows marked 🔒 are security cases.** They matter most. A failure there means
someone can see money or data that is not theirs.

---

## Before you start

1. Ask the developer to confirm the app is running and give you the URL
   (locally this is `http://localhost:3000`).
2. Use a browser you can open **two separate windows** in — one normal, one
   private/incognito. Several cases need two people signed in at once.
3. Keep this page open and fill in the Result column as you go.

### Accounts

| Role | Email | Password |
|---|---|---|
| Administrator | `admin@portfolioops.local` | `ChangeMe!2026` |
| Manager (Norvik Gold) | `aarav@demo.portfolioops.local` | `DemoPassword123` |
| Manager (Thought Agile) | `priya@demo.portfolioops.local` | `DemoPassword123` |
| Manager (Falcon Brews) | `vikram@demo.portfolioops.local` | `DemoPassword123` |
| Employee | `neha@demo.portfolioops.local` | `DemoPassword123` |
| Employee | `kabir@demo.portfolioops.local` | `DemoPassword123` |
| Awaiting approval | `pending@demo.portfolioops.local` | *cannot sign in — that is the point* |

The three ventures are **Norvik Gold**, **Thought Agile** and **Falcon Brews**.

### Known and intentional

Do **not** raise these as defects:

- Invitation and password-reset links are shown on screen to copy by hand.
  Automatic email is switched off until a mail provider is configured.
- **My pay** says pay details are not shown. That is a deliberate setting.
- Some money figures are demo data, not real payroll.

---

## 1. Signing in

| # | Steps | Expected | Result |
|---|---|---|---|
| 1.1 | Sign in as the **administrator** | Lands on Overview with your name in the header | |
| 1.2 | Sign out, then sign in with the right email and a **wrong password** | "Invalid email or password." You stay signed out | |
| 1.3 | Sign in with an email that does not exist, e.g. `nobody@nowhere.com` | **The same** message as 1.2, word for word | |
| 1.4 🔒 | Compare 1.2 and 1.3 | Identical wording. If a wrong password reads differently from an unknown email, an attacker can discover who has accounts | |
| 1.5 | Try to sign in as `pending@demo.portfolioops.local` with any password | Refused. An unapproved account cannot get in | |
| 1.6 | Get the password wrong **9 times in a row** for one email | By the 9th you are told to wait ~15 minutes. This is deliberate | |
| 1.7 | Sign out, then paste `/people` into the address bar | Bounced to the sign-in page, not shown the data | |

## 2. Registration and approval

| # | Steps | Expected | Result |
|---|---|---|---|
| 2.1 | Sign out. On sign-in, click **"Working with us as a freelancer? Request access"** | A registration form appears | |
| 2.2 | Register with a new email, e.g. `tester@example.com`, password at least 10 characters | "Registration received" — you are told an administrator must approve | |
| 2.3 | Try to sign in as that new account immediately | Refused. Awaiting approval | |
| 2.4 🔒 | Check the registration form | There is **no field for a pay rate**. Nobody sets their own pay | |
| 2.5 | As **administrator**, go to People and filter Status = Pending | Your new registration is listed | |
| 2.6 | Click **Approve** on it | Status becomes active | |
| 2.7 | Now sign in as that account | Works. It sees no venture until assigned one | |

## 3. Ventures

| # | Steps | Expected | Result |
|---|---|---|---|
| 3.1 | As administrator, **Ventures → Create venture** | Form asks for name, timezone, working days, edit window, currency | |
| 3.2 | Create "Test Venture", timezone Asia/Kolkata, Mon–Fri, 48 hours, INR | Created and listed | |
| 3.3 | Open it and change the working days to include Saturday, save | Change sticks after reload | |
| 3.4 | Archive it, with a reason | Moves to Archived. Nothing is deleted | |

## 4. People

| # | Steps | Expected | Result |
|---|---|---|---|
| 4.1 | **People → Add person**, fill in a name and email, tick a venture | Created, and an **invitation link** is shown to copy | |
| 4.2 | Copy that link, open it in a **private window**, set a password | Account activates. You can then sign in as them | |
| 4.3 | Open the same invitation link a **second time** | Refused — a link works once | |
| 4.4 | Open any person and look at the tabs | Profile, Work, Hardware, Documents, Compensation | |
| 4.5 | On **Compensation**, set an hourly rate of 1000 INR from the 1st of this month | Saved and listed as current | |
| 4.6 | Change it to 1200, effective next month | **Both** are listed. The old one is not overwritten | |
| 4.7 | Suspend someone, then try to sign in as them | Refused while suspended | |
| 4.8 | Try to suspend **your own** administrator account | Refused — you cannot lock yourself out | |

## 5. Tasks

| # | Steps | Expected | Result |
|---|---|---|---|
| 5.1 | **Tasks → Create task**, leave estimated hours **empty**, submit | Refused. An estimate is required | |
| 5.2 | Create a task with 8 estimated hours, assign it to two people | Appears in Backlog with both names | |
| 5.3 | Drag it from Backlog to In progress | Moves and stays there after reload | |
| 5.4 | Click the card | Detail page: estimate, actual, efficiency, assignees, status history | |
| 5.5 | Enter 1.5 hours as an estimate on a new task | Stored as 1h 30m, not a rounded or odd number | |
| 5.6 | Move a task to Done, then back to Backlog as administrator | Allowed, and the history records both moves | |

## 6. Time tracking

| # | Steps | Expected | Result |
|---|---|---|---|
| 6.1 | Sign in as **neha@**, go to **My day**, click **Start timer** | Timer starts, shown as running | |
| 6.2 | With that running, try to start a **second** timer | Refused, and the message names the task already running | |
| 6.3 | Stop the timer | Recorded. The duration is measured by the server, not your browser clock | |
| 6.4 | Click **Add hours manually**, add 2 hours against a task | Appears in the day's list | |
| 6.5 | Add another 3 hours | Day total reads 5h — **plus** whatever the timer recorded | |
| 6.6 | Edit the 2-hour entry to 4 hours | The total changes. There is still **one** entry, not two | |

## 7. Daily logs and approval

| # | Steps | Expected | Result |
|---|---|---|---|
| 7.1 | As **neha@**, set attendance to Present, then **Submit day for review** | Status becomes Submitted | |
| 7.2 | Try to add more hours to that day | Refused — it is with your manager now | |
| 7.3 | Set attendance to **Absent** on a day that has hours logged, then submit | Refused. You cannot be absent and have worked | |
| 7.4 | Sign in as **aarav@** (Norvik Gold manager) → **Approvals** | Neha's submitted day is listed with its hours | |
| 7.5 | **Return** it with a reason | Goes back to Neha | |
| 7.6 | As Neha, check the bell in the header | A notification says the log was returned, with the reason | |
| 7.7 | Resubmit as Neha, then **Approve** as Aarav | Approved. Those hours are now payable | |
| 7.8 🔒 | As Aarav, submit **your own** day and try to approve it | Refused. Nobody approves their own timesheet | |

## 8. Access control 🔒

**The most important section.** Each case is something that must *not* be possible.

| # | Steps | Expected | Result |
|---|---|---|---|
| 8.1 🔒 | Sign in as **neha@** (employee). Type `/payroll` in the address bar | "You do not have access to payroll." **No figures visible** | |
| 8.2 🔒 | As Neha, try `/audit` | Refused the same way | |
| 8.3 🔒 | As Neha, try `/hr` | Refused | |
| 8.4 🔒 | As Neha, try `/ventures` | Refused | |
| 8.5 🔒 | As **aarav@** (Norvik Gold manager), open People | Only people in **Norvik Gold**. Nobody from the other two ventures | |
| 8.6 🔒 | As Aarav, open Tasks | Only Norvik Gold tasks | |
| 8.7 🔒 | As Aarav, open any person and look for a pay rate | **No Compensation tab.** Managers never see pay | |
| 8.8 🔒 | As Aarav, try `/payroll` | Refused | |
| 8.9 🔒 | As administrator, copy a Thought Agile person's page URL. Sign in as Aarav in a private window and open it | "Not found" — not an error, and no details | |
| 8.10 🔒 | As Neha, try `/people/<some other person id>` | Not found or nothing sensitive shown | |

## 9. Reports

| # | Steps | Expected | Result |
|---|---|---|---|
| 9.1 | As administrator, open **Reports** | Five tabs: Hours, Attendance, Venture performance, Person performance, Task efficiency | |
| 9.2 | On Hours, set a date range and a venture | Figures change to match | |
| 9.3 | Click **Export CSV** | A file downloads and opens in Excel with matching numbers | |
| 9.4 | Find a task with 8h estimated and 10h actual | Efficiency reads **80%** | |
| 9.5 | Find a task with no hours logged | Efficiency shows **–**, never a zero or an error | |
| 9.6 🔒 | As **aarav@**, open Reports and export | Works, but contains **only** Norvik Gold | |

## 10. Payroll

| # | Steps | Expected | Result |
|---|---|---|---|
| 10.1 | As administrator, **Payroll → create a run** for this month | Created as a draft | |
| 10.2 | Open it | Exceptions are listed — missing rates, unapproved hours and so on | |
| 10.3 | Click **Generate lines** | A line per person, with hours, rate and gross pay | |
| 10.4 | Check someone paid hourly | Gross = approved hours × their rate. Verify the arithmetic yourself | |
| 10.5 | Confirm which hours were counted | **Only approved** hours. Draft or submitted-but-unapproved must not be paid | |
| 10.6 | Try to **Mark paid** before locking | Not possible — it says to lock first | |
| 10.7 | **Lock** the run | Status becomes Locked | |
| 10.8 | Try **Generate lines** again | Refused. A locked run cannot be recalculated | |
| 10.9 | **Export CSV** | Downloads with the same figures shown on screen | |
| 10.10 | **Mark paid** one line, with a reference | Shows as paid | |
| 10.11 | Try to **Void** the run now | Refused, because a line is paid | |
| 10.12 | Now change that person's pay rate on their Compensation tab | Reopen the locked run — **the amount has not changed**. This is the most important payroll case | |

## 11. Payroll corrections

| # | Steps | Expected | Result |
|---|---|---|---|
| 11.1 | **Payroll → Adjustments** | Outstanding and settled lists, plus a form | |
| 11.2 | Raise an adjustment of **+2500 INR** for the person you marked paid, with a reason | Listed as outstanding, "settles next run" | |
| 11.3 | Re-check the paid run from section 10 | **Unchanged.** Paid payroll is never rewritten | |
| 11.4 | Create a run for the **next** month and generate lines | That person's pay includes the extra 2500 | |
| 11.5 | Return to Adjustments | It now shows as **settled** | |
| 11.6 | Try to cancel a settled adjustment | Refused. It is part of a paid run | |
| 11.7 | Raise a **negative** adjustment (e.g. −500) and generate the next run | The amount is reduced accordingly | |

## 12. Notifications

| # | Steps | Expected | Result |
|---|---|---|---|
| 12.1 | As a manager, create a task assigned to **kabir@** | — | |
| 12.2 | Sign in as Kabir and check the bell | A badge with an unread count | |
| 12.3 | Open Notifications | "New task: …" with a link to it | |
| 12.4 | Click **Mark read** | The badge count drops | |
| 12.5 🔒 | Compare what Kabir sees with what Neha sees | Each sees **only their own**. No overlap | |

## 13. HR records

| # | Steps | Expected | Result |
|---|---|---|---|
| 13.1 | As administrator, **HR → register an asset** ("MacBook Pro", tag NG-01) | Listed as available | |
| 13.2 | Issue it to someone | Shows as held by them, with the date | |
| 13.3 | Try to issue the **same asset** to someone else | Refused — record the return first | |
| 13.4 | Record its return, then issue it to a different person | Allowed. The history keeps both holders | |
| 13.5 | Add a document with an expiry **20 days away** | Appears under "need attention" | |
| 13.6 | Check that person's Documents tab | The document is listed there too | |

## 14. Audit trail

| # | Steps | Expected | Result |
|---|---|---|---|
| 14.1 | As administrator, open **Audit** | A list of everything sensitive that has happened | |
| 14.2 | Filter to `PAYROLL_LOCKED` | Your lock from 10.7, with **who** did it and **when** | |
| 14.3 | Click "Show change" on any entry | Before and after values | |
| 14.4 🔒 | Look for pay rates in audit entries | Amounts are shown as `[redacted]`. The fact of the change is recorded, not the figure | |
| 14.5 | Check the adjustment from 11.2 appears | Recorded with its reason | |

## 15. Everyday robustness

| # | Steps | Expected | Result |
|---|---|---|---|
| 15.1 | Open the app on a **phone-sized** window | Usable. Nothing runs off the edge; wide tables scroll | |
| 15.2 | Visit a made-up address like `/tasks/does-not-exist` | A clear "not found" page, not a crash | |
| 15.3 | Look at any empty list (a venture with no tasks) | An explanatory message, never a blank white area | |
| 15.4 | Submit a form with a required field empty | Told which field, next to the field | |
| 15.5 | Sign in as a brand-new person with nothing assigned | Every page still loads and explains why it is empty | |

---

## Reporting what you find

For each defect please give:

1. **Case number** (or "not in the plan")
2. **Which account** you were signed in as
3. **What you did** — exact steps
4. **What you expected** vs **what happened**
5. A screenshot if it is visual

Security cases (🔒) should be reported first, however small they look.

## Coverage note

This plan covers the flow a real user follows. It does **not** cover:
performance under load, browsers other than yours, accessibility auditing, or
penetration testing. If those matter for your rollout, they are separate
exercises.
