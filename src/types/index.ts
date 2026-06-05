export interface SerialFrame {
  timestamp: number
  hotendTemp: number
  hotendTarget: number
  bedTemp: number
  bedTarget: number
  percentDone: number
  timeRemainingMins: number
  rawLine: string
  // Extended fields (optional — only present when parsed from that line type)
  fanSpeed?: number        // 0–255 PWM value from "Fan speed:" lines
  zPos?: number            // Z-axis position in mm from position report lines
  action?: string          // Printer action event, e.g. "pause", "cancel", "resume"
}

export interface FailureSnapshot {
  id: string
  triggeredAt: number
  errorMessage: string
  buffer: SerialFrame[]
  printerModel: 'MK3S+'
  imagePath?: string   // relative path under /public/snapshots/
}

export interface DiagnosisResult {
  failureType: string
  anomalyDetected: string
  likelyCause: string
  similarCases: string[]
  fixSteps: string[]
  confidence: 'high' | 'medium' | 'low'
}
