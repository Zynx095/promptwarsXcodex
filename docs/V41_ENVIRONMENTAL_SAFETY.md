# FairShift V4.1 — Environmental Heat Safety & Outdoor Occupational Assessment

**Document Version:** 4.1.0  
**Feature:** Occupational Heat-Stress Assessment & NDMA Frontline Worker Safety  
**Primary Domain Engine:** [`src/domain/heat.ts`](file:///D:/College/SOMESHIT%20DOWNLOADS/ACM/src/domain/heat.ts)  
**Worker Interface:** [`src/client/components/HeatSafetyWidget.tsx`](file:///D:/College/SOMESHIT%20DOWNLOADS/ACM/src/client/components/HeatSafetyWidget.tsx)  
**Integrated Pages:** [`src/client/pages/worker/Reports.tsx`](file:///D:/College/SOMESHIT%20DOWNLOADS/ACM/src/client/pages/worker/Reports.tsx)

---

## 1. Context & Frontline Relevance

Outdoor frontline workers across India (construction laborers, scaffolding crews, campus security, sanitation staff) face extreme environmental conditions. Severe heat waves during pre-monsoon and summer months frequently drive wet-bulb and heat-index values past human physiological coping thresholds, leading to acute heat exhaustion, organ failure, and fatal heat stroke.

FairShift V4.1 implements an **occupational environmental safety module** that translates ambient temperature and humidity into clear, actionable, multilingual safety protocols backed by authoritative Indian disaster and labor standards.

---

## 2. Assessment Methodology & Mathematical Formulation

### NOAA/NWS Rothfusz Regression Algorithm
The Heat Index ($HI$) is derived from ambient dry-bulb temperature ($T$ in °F) and relative humidity ($R$ in %):

$$HI = c_1 + c_2 T + c_3 R + c_4 T R + c_5 T^2 + c_6 R^2 + c_7 T^2 R + c_8 T R^2 + c_9 T^2 R^2$$

Where:
$$\begin{aligned}
c_1 &= -42.379, & c_2 &= 2.04901523, & c_3 &= 10.14333127 \\
c_4 &= -0.22475541, & c_5 &= -0.00683783, & c_6 &= -0.05481717 \\
c_7 &= 0.00122874, & c_8 &= 0.00085282, & c_9 &= -0.00000199
\end{aligned}$$

With standard NOAA corrections for low humidity ($R < 13\%$ and $80^\circ\text{F} \le T \le 112^\circ\text{F}$) and high humidity ($R > 85\%$ and $80^\circ\text{F} \le T \le 87^\circ\text{F}$). The resulting value is converted to Celsius and rounded to 1 decimal place.

### Heat Index vs. Wet Bulb Globe Temperature (WBGT)
> [!NOTE]
> - **Heat Index ($HI$)**: Measures apparent shaded temperature combining ambient heat and humidity.
> - **WBGT**: Integrates direct solar radiation, angle of incidence, and wind velocity using physical black-globe sensors.
> - **Operational Reality**: In direct, unshaded sunlight (e.g. scaffolding or roof work), the effective thermal load increases by up to **$8^\circ\text{C}$ ($15^\circ\text{F}$)** beyond the calculated Heat Index. FairShift clearly communicates this limitation to workers and supervisors.

---

## 3. Occupational Risk Tiers & NDMA Guidelines

FairShift adheres strictly to the **National Disaster Management Authority (NDMA) National Guidelines for Preparation of Action Plan - Prevention and Management of Heat-Wave (2019/2024)** and the **Factories Act, 1948**:

| Tier | Heat Index Range | Work-Rest Cycle | Mandatory Hydration Protocol | Strenuous Activity Advisory |
| :---: | :---: | :---: | :---: | :--- |
| **Normal** | $< 27^\circ\text{C}$ | Standard 15 min / 4h | 250ml per 30 min | Normal operations permitted |
| **Caution** | $27^\circ\text{C} - 32^\circ\text{C}$ | 10 min shade / 2h | 250ml per 20–25 min | Monitor unacclimatized workers |
| **Extreme Caution** | $32^\circ\text{C} - 39^\circ\text{C}$ | 15 min shade / 1h (12–3 PM) | 250ml per 15–20 min | Ventilated shaded rest shelters mandatory |
| **Danger** | $39^\circ\text{C} - 51^\circ\text{C}$ | 30–45 min shade / 45 min work | 250ml per 15 min with ORS/lemon water | Reschedule heavy outdoor tasks to early morning (6–11 AM) |
| **Extreme Danger** | $\ge 51^\circ\text{C}$ | **SUSPEND outdoor work** | 250ml per 10–15 min with electrolytes | **Halt direct sun exposure (concrete pouring, scaffolding)** |

---

## 4. Regional Indian Climate Presets

To ensure ease of use without manual weather API dependencies, FairShift provides verified climate presets:
1. **Delhi Dry Heat**: $42^\circ\text{C}$, $25\%$ RH (High ambient temperature, low moisture).
2. **Chennai Coastal Humid**: $36^\circ\text{C}$, $75\%$ RH (Moderate temperature, severe humidity creating severe apparent heat).
3. **Kolkata Monsoon**: $35^\circ\text{C}$, $80\%$ RH (Post-monsoon high-vapor conditions).
4. **Bengaluru Moderate**: $30^\circ\text{C}$, $50\%$ RH (Plateau baseline).

---

## 5. Direct Worker Reporting & Privacy Protection

- **One-Tap Hazard Link**: When hazardous conditions are identified ($HI \ge 39^\circ\text{C}$), workers can click "Report Heat Hazard", which pre-populates category `hazard.heat` in the confidential safety reporting module.
- **Strict Privacy**: Site-level weather conditions and heat warnings are fully decoupled from individual worker identities. Zero personal or confidential reporting data is leaked.

---

## 6. Verification Test Coverage

Automated tests in [`tests/unit/heat.test.ts`](file:///D:/College/SOMESHIT%20DOWNLOADS/ACM/tests/unit/heat.test.ts) verify:
- Mathematical accuracy of the Rothfusz regression algorithm against NOAA benchmark test cases.
- Proper classification into all 5 occupational safety tiers.
- Regional weather preset consistency.
- Input boundary checking (rejection of $-15^\circ\text{C}$ or $>100\%$ RH).
- Presence of NDMA source attribution and symptom alerts.
