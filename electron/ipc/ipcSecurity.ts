export function isTrustedIpcSender(event: any, mainWindow: any): boolean {
  if (!mainWindow || mainWindow.isDestroyed?.()) return false;
  const sender = event?.sender;
  const senderFrame = event?.senderFrame;
  if (!sender || sender !== mainWindow.webContents || !senderFrame) return false;
  if (senderFrame !== sender.mainFrame) return false;
  return senderFrame.url === sender.getURL();
}