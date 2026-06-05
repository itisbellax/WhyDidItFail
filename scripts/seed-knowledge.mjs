/**
 * Seed the Supabase knowledge base with Prusa troubleshooting entries.
 * Usage: node scripts/seed-knowledge.mjs
 */
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')

// Load .env.local
const envContent = readFileSync(resolve(ROOT, '.env.local'), 'utf-8')
for (const line of envContent.split('\n')) {
  const trimmed = line.trim()
  if (!trimmed || trimmed.startsWith('#')) continue
  const eq = trimmed.indexOf('=')
  if (eq === -1) continue
  process.env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim()
}

const { createClient } = await import('@supabase/supabase-js')
const { OpenAIEmbeddings } = await import('@langchain/openai')
const { SupabaseVectorStore } = await import('@langchain/community/vectorstores/supabase')

const client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY)
const embeddings = new OpenAIEmbeddings({ model: 'text-embedding-3-small', openAIApiKey: process.env.OPENAI_API_KEY })

const entries = [
  {
    content: 'Error: Heating failed. The hotend heater could not reach or maintain target temperature. Causes: loose thermistor wiring at extruder or EINSY board, broken heater cartridge, excessive print-fan airflow cooling the hotend block. Fix: power off immediately, inspect wiring harness, reseat thermistor, test heater cartridge resistance with multimeter (expected 12–16 ohm).',
    metadata: { failureType: 'heating_failed', causes: ['loose thermistor wiring', 'broken heater cartridge', 'excessive fan cooling on hotend'], fixSteps: ['Power off printer immediately', 'Check hotend wiring harness at extruder and EINSY board', 'Reseat thermistor in heater block', 'Test heater cartridge continuity — expect 12–16 ohm'] },
  },
  {
    content: 'Thermal runaway detected. Safety system triggered because temperature dropped unexpectedly. Causes: thermistor reading abnormal values, heater block detached from hotend, cold draft hitting hotend during print. Fix: check full hotend assembly, replace thermistor if bent or corroded, tighten heater block grub screw, enclose printer to prevent drafts.',
    metadata: { failureType: 'thermal_runaway', causes: ['thermistor reading abnormal', 'heater block detached', 'cold air draft'], fixSteps: ['Check full hotend assembly integrity', 'Replace thermistor if bent or corroded', 'Tighten heater block grub screw fully', 'Enclose printer or remove draft sources'] },
  },
  {
    content: 'MINTEMP error: thermistor reading is below minimum threshold (usually below 5°C). Causes: thermistor wire broken or disconnected, thermistor shorted to ground, connector pulled out at EINSY board. Fix: check thermistor connector at EINSY board (slot T0), inspect wire for breaks, replace thermistor if wire is damaged.',
    metadata: { failureType: 'mintemp_error', causes: ['thermistor wire broken', 'connector disconnected at EINSY', 'thermistor shorted'], fixSteps: ['Check thermistor connector at EINSY board slot T0', 'Inspect thermistor wire along cable harness for cuts or pinches', 'Measure thermistor resistance at room temp — expect ~100k ohm for NTC100k', 'Replace thermistor if resistance reads 0 or open circuit'] },
  },
  {
    content: 'MAXTEMP error: thermistor reading is above maximum threshold (usually above 290°C). Causes: thermistor shorted internally, thermistor wire touching heater block, wrong thermistor type installed. Fix: power off immediately (fire risk), check thermistor wire is not touching heater block, verify correct thermistor type (Prusa uses NTC100k), replace thermistor.',
    metadata: { failureType: 'maxtemp_error', causes: ['thermistor shorted internally', 'thermistor wire touching heater block', 'wrong thermistor type'], fixSteps: ['Power off immediately — MAXTEMP can indicate fire risk', 'Check thermistor wire is not contacting heater block directly', 'Verify correct thermistor type (Prusa MK3S+ uses NTC100k)', 'Replace thermistor and re-run PID calibration'] },
  },
  {
    content: 'Under extrusion: gaps and weak layers in print. Causes: partial nozzle clog, temperature too low for filament, bowden tube gap at extruder, worn hobbed gear. Fix: cold pull to clear partial clog, increase temp by 5°C, reseat bowden tube, inspect extruder gear teeth.',
    metadata: { failureType: 'under_extrusion', causes: ['partial nozzle clog', 'temperature too low', 'bowden tube gap', 'worn extruder gear'], fixSteps: ['Perform cold pull to clear partial clog', 'Increase hotend temperature by 5°C', 'Reseat bowden tube at extruder', 'Inspect and clean hobbed extruder gear teeth'] },
  },
  {
    content: 'Clogged nozzle: no filament extruding at all or extreme under extrusion. Causes: carbonised filament blocking nozzle, foreign material, printing too close to bed on first layer. Fix: heat to 260°C and manually push filament, perform atomic/cold pull with nylon, use acupuncture needle to clear nozzle, replace nozzle if repeated clogs occur.',
    metadata: { failureType: 'clogged_nozzle', causes: ['carbonised filament', 'foreign material in nozzle', 'first layer too close to bed'], fixSteps: ['Heat nozzle to 260°C and try manually pushing filament', 'Perform atomic/cold pull using nylon filament', 'Use 0.4mm acupuncture needle to probe nozzle opening', 'Replace nozzle if cold pull fails repeatedly'] },
  },
  {
    content: 'Extruder clicking or grinding: loud clicking from extruder during print. Causes: partial clog causing back-pressure, idler tension too high or too low, filament diameter inconsistency, bowden tube gap. Fix: check and clear partial clog, adjust idler screw tension (spring compressed ~1mm on MK3S+), reseat bowden tube, try different filament spool.',
    metadata: { failureType: 'extruder_clicking', causes: ['partial clog causing back-pressure', 'incorrect idler tension', 'bowden tube gap'], fixSteps: ['Check for and clear partial nozzle clog', 'Adjust idler tension — spring should be compressed ~1mm', 'Reseat bowden tube at both extruder and hotend ends', 'Try a different filament spool to rule out diameter inconsistency'] },
  },
  {
    content: 'Over extrusion: blobs, rough surface, dimensions larger than expected. Causes: extrusion multiplier too high, incorrect filament diameter setting, temperature too high. Fix: reduce extrusion multiplier by 5% increments, verify filament diameter in slicer, reduce temperature by 5°C.',
    metadata: { failureType: 'over_extrusion', causes: ['extrusion multiplier too high', 'wrong filament diameter in slicer', 'temperature too high'], fixSteps: ['Reduce extrusion multiplier by 5% in slicer and test', 'Measure actual filament diameter with calipers and update slicer setting', 'Reduce hotend temperature by 5°C', 'Run extrusion calibration (e-steps) if problem persists'] },
  },
  {
    content: 'Bed adhesion failure: print lifts or detaches during printing. Causes: bed temperature too low, first layer printing too fast, dirty bed surface, incorrect first layer height. Fix: increase bed temp by 5°C, reduce first layer speed to 15mm/s, clean bed with IPA, re-run first layer calibration.',
    metadata: { failureType: 'bed_adhesion_failure', causes: ['bed temperature too low', 'first layer too fast', 'dirty bed surface', 'incorrect first layer height'], fixSteps: ['Increase bed temperature by 5°C (PLA) or 10°C (PETG/ABS)', 'Reduce first layer speed to 15mm/s', 'Clean print bed with IPA and lint-free cloth', 'Re-run first layer height calibration'] },
  },
  {
    content: 'Warping: corners of print lift off bed during or after printing. Causes: cooling too fast on large parts, bed temperature too low, printing ABS/ASA without enclosure, incorrect first layer height. Fix: increase bed temp 5–10°C, disable part cooling fan for first 3 layers, add brim in slicer, enclose printer for ABS/ASA.',
    metadata: { failureType: 'warping', causes: ['rapid cooling on large parts', 'bed temperature too low', 'no enclosure for ABS/ASA'], fixSteps: ['Increase bed temperature by 5–10°C', 'Disable part cooling fan for first 3 layers', 'Add 5–10mm brim in slicer settings', 'Enclose printer when printing ABS, ASA, or PC'] },
  },
  {
    content: "Elephant's foot: first layer squishes wider than subsequent layers, causing base to bulge outward. Causes: first layer height too low (Live Adjust Z too negative), bed temperature too high. Fix: raise Live Adjust Z by 0.05–0.1mm increments until first layer has slight texture, reduce bed temperature by 5°C.",
    metadata: { failureType: 'elephants_foot', causes: ['first layer too close to bed', 'bed temperature too high'], fixSteps: ['Raise Live Adjust Z by 0.05mm increments until first layer has slight texture', 'Reduce bed temperature by 5°C', 'Enable first layer compensation in slicer if available'] },
  },
  {
    content: 'Layer shift: print layers suddenly misaligned horizontally. Causes: print speed too high, loose X or Y belt, insufficient motor current, print head collision with part. Fix: reduce print speed 20%, tension X/Y belts, check motor current, lubricate linear rods.',
    metadata: { failureType: 'layer_shift', causes: ['print speed too high', 'loose belt', 'insufficient motor current', 'print head collision'], fixSteps: ['Reduce print speed by 20%', 'Tension X and Y belts until they produce a clear tone', 'Check motor current settings in firmware', 'Clean and lubricate linear rods with super-lube'] },
  },
  {
    content: 'Z wobble or Z banding: horizontal ripples on vertical surfaces at regular intervals. Causes: bent Z lead screw, loose Z coupler between motor and lead screw, unstable printer surface. Fix: tighten Z coupler grub screws, place printer on stable flat surface, run Z axis full range several times to self-align lead screw.',
    metadata: { failureType: 'z_wobble', causes: ['bent Z lead screw', 'loose Z coupler', 'unstable printer surface'], fixSteps: ['Tighten both grub screws on Z axis coupler', 'Place printer on stable, level, vibration-free surface', 'Run Z axis full range 5 times to self-align lead screw', 'Check X-axis belt tension and rods for straightness'] },
  },
  {
    content: 'Stringing or oozing: thin strings of filament between separate parts of the print. Causes: retraction distance too short, temperature too high, travel speed too slow, wet filament. Fix: increase retraction 0.5mm increments (max 2mm on MK3S+ direct drive), reduce temperature 5°C, increase travel speed to 150mm/s, dry filament if severe.',
    metadata: { failureType: 'stringing', causes: ['insufficient retraction', 'temperature too high', 'travel speed too slow', 'wet filament'], fixSteps: ['Increase retraction distance in 0.5mm steps (max 2mm on MK3S+)', 'Reduce hotend temperature by 5°C', 'Increase travel speed to 150mm/s', 'Dry filament at 45°C for 4–6 hours if stringing is severe'] },
  },
  {
    content: 'PINDA probe or bed leveling failure: mesh bed leveling produces large deviations or calibration cannot complete. Causes: PINDA probe height incorrect (should be 1mm above nozzle), steel sheet warped, probe trigger point inconsistent due to temperature. Fix: adjust PINDA height to 1mm above nozzle, preheat before calibration, replace steel sheet if warped.',
    metadata: { failureType: 'pinda_failure', causes: ['PINDA probe height incorrect', 'steel sheet warped', 'probe temperature inconsistency'], fixSteps: ['Set PINDA probe height to exactly 1mm above nozzle tip', 'Preheat printer to print temperature before running mesh calibration', 'Run first layer calibration after adjusting PINDA height', 'Replace PEI steel sheet if mesh shows consistent warp pattern'] },
  },
]

console.log(`Seeding ${entries.length} entries into Supabase…`)

const store = await SupabaseVectorStore.fromTexts(
  entries.map(e => e.content),
  entries.map(e => e.metadata),
  embeddings,
  { client, tableName: 'print_knowledge', queryName: 'match_print_knowledge' }
)

console.log('\nVerifying retrieval…')
const retriever = store.asRetriever({ k: 3 })

const tests = [
  'Error: Heating failed thermistor',
  'clicking extruder filament grinding',
  'print lifting off bed warping corners',
]

for (const query of tests) {
  const results = await retriever.invoke(query)
  console.log(`\n"${query}"`)
  results.forEach((d, i) => console.log(`  [${i+1}] ${d.metadata.failureType} — ${d.pageContent.slice(0, 60)}…`))
}

console.log('\n✓ Done.')
