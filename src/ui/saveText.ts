// Hands a file to the browser's download. Nothing leaves the device.
export function saveBlob(fileName: string, blob: Blob) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.click()
  // Give the browser a moment to start the download before the URL goes away.
  setTimeout(() => URL.revokeObjectURL(url), 10000)
}

export function saveText(fileName: string, text: string) {
  saveBlob(fileName, new Blob([text], {type: 'text/plain;charset=utf-8'}))
}
