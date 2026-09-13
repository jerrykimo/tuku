const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getLibrary:       ()         => ipcRenderer.invoke('get-library'),
  getChangelog:     ()         => ipcRenderer.invoke('get-changelog'),
  removeImage:      (id)       => ipcRenderer.invoke('remove-image', id),
  removeImages:     (ids)      => ipcRenderer.invoke('remove-images', ids),
  updateImage:      (id, changes) => ipcRenderer.invoke('update-image', { id, changes }),
  batchUpdateImages:(payload)  => ipcRenderer.invoke('batch-update-images', payload),
  createCollection: (name)     => ipcRenderer.invoke('create-collection', name),
  renameCollection: (id, name) => ipcRenderer.invoke('rename-collection', id, name),
  deleteCollection: (id)       => ipcRenderer.invoke('delete-collection', id),
  restoreImage:     (id)       => ipcRenderer.invoke('restore-image', id),
  emptyTrash:       ()         => ipcRenderer.invoke('empty-trash'),
  createBackup:     ()         => ipcRenderer.invoke('create-backup'),
  saveCollage:      (payload)  => ipcRenderer.invoke('save-collage', payload),
  openInFinder:     (relPath)  => ipcRenderer.invoke('open-in-finder', relPath),
  addImages:        ()         => ipcRenderer.invoke('add-images'),
});
