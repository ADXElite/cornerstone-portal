# Chrome Web Store submission — Cornerstone Portal Dismissal Board

Upload file: **cornerstone-portal-dismissal-board-1.0.0.zip**
Images: **icon128.png**, **screenshot-1-board.png**, **screenshot-2-pick-class.png** (1280×800), **promo-small-440x280.png**

---

## 1. Developer account (one time)
1. Sign in to Chrome with your **@csjax.org** Google account (it must be in the school's Google Workspace so you can publish **Private** to the school only).
2. Go to **https://chrome.google.com/webstore/devconsole** → accept the agreement → pay the one-time $5 registration fee.
3. Account → set **Publisher name**: `Cornerstone Christian School` and a contact email (DCorley@csjax.org). Verify the email.

## 2. Upload
Developer Dashboard → **+ New item** → upload the zip.

## 3. Store listing tab
| Field | Enter |
|---|---|
| **Title** | Cornerstone Portal Dismissal Board *(comes from the zip)* |
| **Summary** | Opens your class's Cornerstone dismissal board full-screen from 2:35 to 3:30 PM on school days, then closes it. *(comes from the zip)* |
| **Category** | Education |
| **Language** | English (United States) |
| **Store icon** | icon128.png |
| **Screenshots** | screenshot-1-board.png, screenshot-2-pick-class.png |
| **Small promo tile** | promo-small-440x280.png |
| **Homepage URL** | https://portal.csjax.org |
| **Support URL** | https://www.csjax.org |

**Description** (paste):
```
For Cornerstone Christian School teachers and classroom Chromebooks.

Every school day (Monday–Friday) at 2:35 PM, this extension opens your class's dismissal board from the Cornerstone Portal full-screen, and closes it at 3:30 PM.

• Pick your class once — it's remembered for every day after, on any Chromebook you sign in to.
• The board shows how each student is going home today: car rider, bus number, after-school care, walker.
• Parent and office dismissal changes for today are marked "Changed", and students checked out early are listed at the bottom.
• The board refreshes every minute.
• "Change class" and "Close board" buttons are at the bottom of the screen. Closing it keeps it closed until the next school day.
• Click the extension icon to open the board at any other time.

Dismissal boards can only be viewed on the Cornerstone campus network.
```

## 4. Privacy practices tab
| Field | Enter |
|---|---|
| **Single purpose** | Opens the school's classroom dismissal board (portal.csjax.org/classroom) full-screen on teachers' Chromebooks during afternoon dismissal (2:35–3:30 PM on school days) and closes it afterward. |
| **alarms** justification | Checks once a minute whether it is the dismissal time (2:35–3:30 PM New York time, Monday–Friday) so the board opens and closes on schedule. |
| **storage** justification | Remembers the teacher's chosen class, whether the board was closed today (so it stays closed), and optional settings from the school's IT administrator. Nothing leaves the browser except Chrome sync of the chosen class. |
| **Host permission** justification (content script on `https://portal.csjax.org/classroom*`) | Runs only on the school's own dismissal board page so the on-screen "Close board" button can close the extension's window and the teacher's class choice can be remembered. It does not read page content. |
| **Remote code** | **No, I am not using remote code.** |
| **Data usage** | Check **none** of the data types. Tick all three certifications (not sold, not used for unrelated purposes, not used for credit). |
| **Privacy policy URL** | https://portal.csjax.org/privacy-extension |

## 5. Distribution tab
- **Visibility: Private** → **Only trusted testers / users in my domain (csjax.org)**. *(If "Private" isn't offered, your developer account isn't on @csjax.org — use **Unlisted** instead.)*
- Regions: United States (or all).
- Click **Submit for review**. Private domain items are usually approved in 1–3 business days.

## 6. Push it to teacher Chromebooks (Google Admin)
1. **admin.google.com** → Devices → Chrome → **Apps & extensions** → **Users & browsers**.
2. Select the **teachers'** organizational unit.
3. **+** (yellow button) → **Add Chrome app or extension by ID** → paste the extension ID from the Developer Dashboard (or pick it under "From your domain").
4. Installation policy: **Force install** (optionally **+ pin to browser toolbar**). Save.
5. Optional **Policy for extensions** (same screen, JSON). Leave `board` out so each teacher picks their own class:
   ```json
   { "start": { "Value": "14:35" }, "end": { "Value": "15:30" }, "weekdaysOnly": { "Value": true } }
   ```

**Important:** remove the old **Cornerstone Dismissal Board Launcher** (app.csjax.org, opens at 2:30) from the same OU, or teachers will get two boards.

## How it behaves
- 2:35 PM Mon–Fri: opens `portal.csjax.org/classroom` full-screen. If the Chromebook is asleep or off at 2:35, it opens as soon as it's back on before 3:30.
- First time: teacher taps their class. Saved with Chrome sync (follows their school account) and used for every launch after.
- Bottom bar: **Change class** (opens the class list) and **Close board** (closes it until the next school day).
- 3:30 PM: closes automatically.
- Toolbar icon: opens the board any time.
- Off the campus network the page shows "Campus network only".

## Updating later
Change the files, raise `"version"` in manifest.json (e.g. 1.0.1), zip the folder contents, Developer Dashboard → the item → **Package** → **Upload new package** → Submit. Chromebooks update on their own within a few hours.
