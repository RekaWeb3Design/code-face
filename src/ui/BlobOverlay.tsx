import {memo} from 'react'
import {labelPlacement, type Ellipse} from './blobGeometry'

export type GrowthOutlines = {id: number; ellipses: Ellipse[]}

type Props = {
  width: number // picture size in its own pixels (the canvas)
  height: number
  growth: GrowthOutlines[] // outlines of blobs just added by growth; they fade out
  hovered: {index: number; ellipse: Ellipse} | null // the blob of the hovered or focused code line
}

const shape = (e: Ellipse, key?: number) => (
  <ellipse key={key} cx={e.cx} cy={e.cy} rx={e.rx} ry={e.ry} transform={`rotate(${e.angleDeg} ${e.cx} ${e.cy})`} />
)

// Outlines over the picture, drawn from real blob params in the picture's own pixel units. Everything is
// clipped to the picture (overflow: hidden in the stylesheet), and the label is placed inside it.
export const BlobOverlay = memo(function BlobOverlay({width, height, growth, hovered}: Props) {
  const fontSize = Math.max(width, height) / 30
  return (
    <svg className="overlay" viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      {growth.map((group) => (
        <g key={group.id} className="grow-outlines">
          {group.ellipses.map((e, k) => shape(e, k))}
        </g>
      ))}
      {hovered && <HoveredBlob {...hovered} width={width} height={height} fontSize={fontSize} />}
    </svg>
  )
})

function HoveredBlob(props: {index: number; ellipse: Ellipse; width: number; height: number; fontSize: number}) {
  const {index, ellipse, width, height, fontSize} = props
  const label = `blob ${index + 1}`
  const at = labelPlacement(ellipse, width, height, fontSize, label.length)
  return (
    <g className="hovered-blob">
      {shape(ellipse)}
      <text x={at.x} y={at.y} fontSize={fontSize} textAnchor="middle">
        {label}
      </text>
    </g>
  )
}
