# Threat Detection Study (EIN3241, Group 2)

A browser app for running the 2 × 2 within-subjects study (AI bias × time pressure), saving the data, simulating extra participants from the pilot data, and running the analysis.

## Running it on a team laptop

**Link for the team: https://grantrotbart.github.io/threat-detection-study/**

Open it in **Chrome or Edge** on the laptop you will test on. Nothing to install. Data is saved in that laptop's browser and never leaves it until you export or send the JSON files. Always use the same browser on the same laptop, and don't use a private/incognito window, because that erases the data when it closes. (You can also double-click `index.html` from a downloaded copy, but then use only that copy, since the link and the file keep separate data.)

With default settings the protocol code is **QST-GIW**. Every laptop should show this code.

### One-time setup on each laptop
1. **Run session** tab → enter your **name** and the **laptop make & model**. These are saved with every session.
2. **Calibrate screen**: set browser zoom to 100% (Ctrl+0 / Cmd+0), hold a credit card or Gator 1 card against the screen, and adjust the rectangle until it matches the card exactly. After this, the bag images are **190 × 127 mm on every laptop**. Recalibrate if you change the zoom, display scaling or screen; the app detects this and asks.
3. Check the **protocol code** in the top-right of the Run tab. It must be the **same on every team laptop**. If it differs, someone changed a setting: use Settings → *Load settings file* with the coordinator's file.

If the app says the image doesn't fit your screen, the team must lower **Image width** in Settings to the smallest laptop's maximum, *on every laptop* (then the protocol codes match again).

### Participant numbers (avoid collisions)
Each laptop numbers sessions independently, so **assign each teammate their own participant numbers** before collecting data. For example, with 5 people and 12 participants: Person A takes P01–P03, B P04–P06, C P07–P08, D P09–P10, E P11–P12. The condition order comes from the number, so any split keeps the Latin square balanced as long as all 12 numbers get used. If someone drops out, rerun with a number in the same order (P13 replaces P01/P05/P09, P14 replaces P02/P06/P10, and so on).

### Each session
1. Pick your next assigned number and click **Start session**.
2. The first screen is the **setup check** (brightness all the way up, charger in, Night Light/True Tone off, zoom 100%, notifications off, participant at arm's length). Every item must be ticked before the participant starts. The participant instructions repeat the brightness reminder.
3. The participant then sees: consent, demographics, instructions, 8 practice trials (no AI), then 4 sections of 20 bags, each followed by the 12-item trust scale.
4. Press **Esc** to pause or stop. Stopped sessions can be resumed from the Run tab; the unfinished section restarts from its first trial.
5. When the session ends, a JSON file downloads (for example `P04_threat-study_2026-11-20.json`). **Send it to the data coordinator.**

Use **Test / practice run** for trying the app yourselves. Test runs are left out of the analysis.

### Coordinator: merging everyone's data
Data → **Import JSON files…** and select all the files you received (several at once is fine).
* Re-importing the same session is safe: the copy with more data is kept.
* If two laptops used the **same participant number**, the second one is kept as `P03-dup2`, excluded from analysis, and you get a warning. Decide which participant keeps the number.
* If sessions were run with **different protocol codes**, the Data and Analysis tabs show a warning.
* **Sessions & hardware CSV** lists each session's experimenter, laptop, browser, screen resolution, calibration, the image size actually shown, and whether the image ever had to shrink. Use it for the hardware-differences paragraph in your report.

## Counterbalancing

* Condition order follows a balanced Latin square (Williams design). Participant *n* uses row ((n − 1) mod 4) + 1, so 12 participants give 3 per order.
* Image sets S1–S4 rotate across conditions, so every set is used with every condition equally often.
* AI system names (ARGUS, SENTINEL, VIGIL, ORION) are tied to section position, not to condition.

## Stimuli

* **Threats** come in three types, each with three variants: knives (kitchen knife, dagger, folding knife), guns (pistol, compact pistol, revolver) and bombs (pipe bomb, explosive block, device in a box). Size and proportions vary from image to image. Each image set has the same mix (in a 10-threat set: 4 knives, 3 guns, 3 bombs).
* **Clutter**: 15–19 everyday items per bag at medium difficulty, some placed on top of the threat so it is partly hidden.
* **Look-alike items** ("lures"): scissors, screwdriver, wrench, corkscrew, hair dryer, plastic toy, batteries and power bank. Every bag gets 1–2 of them (medium difficulty) from the same random process whether or not it holds a threat, so a lure never gives away the answer. The instructions show all threats and lures and say clearly that lures are not threats.
* **AI recommendation**: shown on the image itself, as a red or green glowing frame plus a "THREAT"/"CLEAR" label at the top center, so participants can't miss it.

## AI manipulation (instructor feedback #1)

Each section has 20 bags (10 threat, 10 clear). The AI is wrong on 4 of them (80% accuracy), and the errors always fall on trials 7, 12, 14 and 19.

| AI | Hits | Misses | False alarms | Correct rejections | Hit rate | FA rate |
|---|---|---|---|---|---|---|
| False-alarm-prone | 10 | 0 | 4 | 6 | 100% | 40% |
| Miss-prone | 6 | 4 | 0 | 10 | 60% | 0% |

Settings can switch this to a 3 + 1 mix (for example 3 false alarms and 1 miss) or to 40 trials per section. The Settings page always shows the current table.

## Measures

* **d′** = z(H) − z(F), **c** = −½[z(H) + z(F)], **β** = exp(c·d′). These use a log-linear correction: H = (hits + .5)/(threat trials + 1). Timeouts are excluded.
* **Agreement with incorrect AI advice**: % of AI-error trials where the participant went along with the AI.
* **Rejection of correct AI advice** (instructor feedback #2): % of AI-correct trials where the participant went against the AI. This measures under-reliance.
* **Trust**: Jian et al. (2000), 12 items rated 1–7. Items 1–5 are reverse-scored and the score is the mean.

## Feedback (instructor feedback #3)

By default, after every trial participants see whether their answer was correct and what the bag contained. That also tells them whether the AI was right, which is how they can learn its error pattern. Settings can turn feedback off for the AI sections. Each trial row records `feedbackShown` and `half` (first or second half of the section), so you can test whether reliance changes as participants learn.

## Simulation (88 participants)

Analysis & simulation → **Generate simulated participants**. For each measure, simulated values are drawn from a multivariate normal using the pilot means and the 4 × 4 pilot covariance across conditions. This keeps each person's values correlated across conditions, the way repeated measures are. Values are clipped to their possible range, and H, F, accuracy and β are computed from the simulated d′ and c. The same seed always gives the same data.

## Exports

* **Trials CSV**: one row per trial, real participants only. It includes `threatType` and `threatVariant`, so you can check whether some threats were harder than others.
  * `rt_ms`: response time in milliseconds, from the moment the image appears to the key press or click. Blank on timeouts.
  * `imageWidthMm`: the physical width the image was shown at on that trial (190 mm unless the window was too small).
  * `inputMethod`: `key` (F/J) or `click`. Clicking is slower than pressing a key, so check this before comparing RTs, and ask participants to use the keys.
* **Condition summary CSV**: one row per participant × condition. It includes mean RT overall, mean RT when the participant followed the AI and when they overrode it, and how many answers were clicks.
* **Long / wide CSV** (Analysis tab): real, simulated, or combined data. The wide format plugs straight into SPSS or JASP repeated-measures ANOVA.
* **Sessions & hardware CSV**: one row per session with experimenter, laptop, screen, calibration and displayed image size.
* **Full backup (JSON)**: everything. **Import** merges JSON files from other laptops.
