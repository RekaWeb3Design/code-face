import type {AccumFormat} from '../fitter/device'
import type {InitMode} from '../fitter/init'
import type {LoopStats} from '../fitter/runLoop'
import type {SelfTestResult} from '../fitter/selfTest'

type Props = {
  stats: LoopStats | null
  accumFormat: AccumFormat
  canChooseAccum: boolean // float32-blendable available
  onAccumFormat: (format: AccumFormat) => void
  initMode: InitMode
  onInitMode: (mode: InitMode) => void
  selfTest: SelfTestResult | 'running' | null
  canRunSelfTest: boolean
  onSelfTest: () => void
}

const sci = (x: number) => x.toExponential(2)
// One self-test number with its verdict against a limit; informational numbers get no verdict.
const check = (err: number, limit: number, strict: boolean) =>
  `${sci(err)} ${!strict ? '(info)' : err < limit ? 'ok' : 'FAIL'}`
const verdict = (row: {strict: boolean; pass: boolean}) => (!row.strict ? 'info' : row.pass ? 'pass' : 'FAIL')

// Developer tools: readouts, start mode, accumulation format and the GPU self-test.
export function DevTools(props: Props) {
  const {stats, accumFormat, canChooseAccum, onAccumFormat, initMode, onInitMode, selfTest} = props
  const sigma = stats?.sigma
  const tested = selfTest && selfTest !== 'running' ? selfTest : null
  return (
    <details className="devtools">
      <summary>dev</summary>
      <p className="dev-readout">
        {stats?.stepsPerSecond != null ? stats.stepsPerSecond.toFixed(0) : '–'} steps/s
        <br />
        sigma mean {sigma ? sigma.meanPx.toFixed(2) : '–'} px · max {sigma ? sigma.maxPx.toFixed(2) : '–'} px
        <br />
        at cap ({sigma ? sigma.capPx.toFixed(2) : '–'} px): {sigma ? sigma.atCap.toLocaleString('en-US') : '–'} blobs
        <br />
        accumulation {accumFormat}
        {accumFormat === 'rgba16float' && ' · reduced precision'}
      </p>
      <label>
        Start from
        <select value={initMode} onChange={(event) => onInitMode(event.target.value as InitMode)}>
          <option value="painting">painting</option>
          <option value="blank">blank canvas</option>
          <option value="photo">the photo</option>
        </select>
      </label>
      {canChooseAccum && (
        <label>
          Accumulation
          <select value={accumFormat} onChange={(event) => onAccumFormat(event.target.value as AccumFormat)}>
            <option value="rgba16float">rgba16float</option>
            <option value="rgba32float">rgba32float</option>
          </select>
        </label>
      )}
      <button onClick={props.onSelfTest} disabled={selfTest === 'running' || !props.canRunSelfTest}>
        {selfTest === 'running' ? 'Running GPU self-test…' : 'Run GPU self-test'}
      </button>
      {tested && (
        <div className="selftest">
          <p className={tested.pass ? 'pass' : 'fail'}>
            {tested.pass ? 'PASS' : 'FAIL'} · fits with {tested.fitFormat}
            {tested.reducedPrecision && ' · reduced precision (no float32-blendable on this device)'}
          </p>
          {tested.rows.map((row) => (
            <p key={row.format}>
              {verdict(row)} · {row.format}
              <br />
              loss gpu {row.lossGpu.toFixed(6)} / cpu {row.lossCpu.toFixed(6)}, rel. error {sci(row.lossErr)} (limit{' '}
              {sci(row.lossThreshold)})
              <br />
              gradients: max rel. error {sci(row.gradErr)} on {row.worstParam} (limit {sci(row.gradThreshold)})
            </p>
          ))}
          {tested.subsample.map((row) => (
            <p key={row.format}>
              {verdict(row)} · subsampled gather · {row.format} (limit {sci(row.threshold)})
              <br />
              full gradient vs cpu {check(row.fullErr, row.threshold, row.strict)}
              <br />
              each of 12 grids vs cpu on the same grid, worst{' '}
              {check(row.gridErr, row.threshold, row.strict && row.gridStrict)}
              <br />
              mean of the 12 grids vs full {check(row.meanErr, row.threshold, row.strict)}
              <br />
              one grid vs full (noise, no limit): median {sci(row.singleMedian)}, max {sci(row.singleMax)}
            </p>
          ))}
          <p>
            {tested.adamPass ? 'pass' : 'FAIL'} · first Adam step: max error {sci(tested.adamErr)} of one learning
            rate (limit {sci(tested.adamThreshold)})
          </p>
          <p>
            {tested.inactive.pass ? 'pass' : 'FAIL'} · inactive blobs contribute nothing: loss{' '}
            {tested.inactive.sameLoss ? 'identical' : 'DIFFERS'}, gradients{' '}
            {tested.inactive.sameGradients ? 'identical' : 'DIFFER'}, their own gradients{' '}
            {tested.inactive.zeroGradients ? 'zero' : 'NOT ZERO'}, their params after a step{' '}
            {tested.inactive.untouched ? 'untouched' : 'CHANGED'}
          </p>
        </div>
      )}
    </details>
  )
}
