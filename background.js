// PromptBooks - Background Service Worker
// 點擊擴充圖示時開啟側邊面板

chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error('Failed to set panel behavior:', error));
