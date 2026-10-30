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

$$ \begin{aligned}
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

## 3. Risk Categories and Advisory Guidance (corrected in the final engineering audit)

The previous table claimed the tiers followed NDMA guidelines **and the Factories Act, 1948**, labelled hydration as "mandatory", and prescribed work-rest cycles (e.g. "30–45 min shade / 45 min work", "SUSPEND outdoor work") without a source. The Factories Act does not prescribe these cycles, and NDMA's heat-wave guidance is advisory. Thresholds were also approximated in °C (27/32/39/51), which misclassified values just under the NWS boundaries.

Current behaviour (`src/domain/heat.ts`):

| NWS category | Heat Index | Advice shown (all advisory) | Source |
| :-- | :-- | :-- | :-- |
| Normal | < 80°F (26.7°C) | Drink water regularly; watch unacclimatised workers | General |
| Caution | 80–89°F | About 1 cup (250 ml) every 15–20 min while working; short shade breaks | OSHA/NIOSH hydration guidance; NWS category effects |
| Extreme Caution | 90–102°F | As above; more frequent shade breaks, especially 12–3 PM; shade and head covering | NDMA heat-wave advice (avoid strenuous activity 12–3 PM) |
| Danger | 103–124°F | As above plus ORS; supervisor-set work-rest schedule, ideally from WBGT; avoid strenuous work 12–3 PM; work in pairs | NDMA (ORS, timing); NIOSH (WBGT-based work-rest) |
| Extreme Danger | ≥ 125°F (51.7°C) | Stop strenuous work in direct sun unless essential; resume under a supervisor-set schedule | NWS category effects ("heat stroke highly likely") |

Classification uses the NWS °F boundaries directly. The UI states that the advice is not a legal requirement.

### Calculation corrections

- The simple Steadman formula is now **averaged with the air temperature** before the 80°F test, as the NWS procedure specifies (previously the unaveraged value was used and returned).
- Non-finite inputs (`NaN`, `Infinity`) are rejected.
- Regression tests compare against NWS chart values within 2.5°F (Rothfusz's stated fit error is about ±1.3°F and the chart is rounded) and assert every classification matches the °F boundaries across 20–50°C × 10–95% RH.

### Inputs and limitations

- Inputs are **manual**: the worker or supervisor sets temperature and humidity with sliders or picks a preset. There is no live weather feed, so there is no stale or unavailable-data state; the values shown are only as current as what was entered.
- The Heat Index is a shaded, light-wind estimate. It is not WBGT and ignores solar load, workload, clothing and acclimatisation. It must not be presented as an occupational exposure measurement.
- Advisory text is English only (it is generated in the domain module, not the locale files).

---

## 4. Regional Indian Climate Presets

To ensure ease of use without manual weather API dependencies, FairShift provides verified climate presets:
1. **Delhi Dry Heat**: $42^\circ\text{C}$, $25\%$ RH (High ambient temperature, low moisture).
2. **Chennai Coastal Humid**: $36^\circ\text{C}$, $75\%$ RH (Moderate temperature, severe humidity creating severe apparent heat).
3. **Kolkata Monsoon**: $35^\circ\text{C}$, $80\%$ RH (Post-monsoon high-vapor conditions).
4. **Bengaluru Moderate**: $30^\circ\text{C}$, $50\%$ RH (Plateau baseline).

---

## 5. Direct Worker Reporting & Privacy Protection

- **Hazard Link**: The widget always shows a "Report Heat Hazard" link to the safety report form. It does not pre-select a category; workers choose "Heat stress / no shade or water" themselves.
- **Strict Privacy**: Site-level weather conditions and heat warnings are fully decoupled from individual worker identities. Zero personal or confidential reporting data is leaked.

---

## 6. Verification Test Coverage

Automated tests in [`tests/unit/heat.test.ts`](file:///D:/College/SOMESHIT%20DOWNLOADS/ACM/tests/unit/heat.test.ts) verify:
- The NWS procedure (simple-formula averaging, Rothfusz regression, humidity adjustments) against NWS chart values.
- Proper classification into all 5 occupational safety tiers.
- Regional weather preset consistency.
- Input boundary checking (rejection of $-15^\circ\text{C}$ or $>100\%$ RH).
- Presence of NDMA source attribution and symptom alerts.
$$
