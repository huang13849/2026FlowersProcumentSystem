import React, { useState, useEffect, useRef, useCallback } from 'react'

// ── Full‑screen image preview overlay ──
export function ImagePreview({ src, onClose }) {
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: 'rgba(0,0,0,0.85)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        cursor: 'zoom-out',
      }}
    >
      <img
        src={src}
        alt="预览"
        style={{
          maxWidth: '90vw', maxHeight: '90vh',
          objectFit: 'contain',
          borderRadius: 6,
          boxShadow: '0 8px 40px rgba(0,0,0,0.5)',
        }}
      />
      <span
        onClick={onClose}
        style={{
          position: 'fixed', top: 16, right: 24,
          fontSize: 32, color: '#fff', cursor: 'pointer',
          fontWeight: 300, lineHeight: 1,
        }}
      >×</span>
    </div>
  )
}

// ── Image cell: shows thumbnails, supports paste from clipboard + click to preview ──
export function ImageCell({ images = [], maxCount = 2, onPaste, onRemove }) {
  const cellRef = useRef(null)
  const [previewUrl, setPreviewUrl] = useState(null)

  const handlePaste = useCallback((e) => {
    const items = e.clipboardData?.items
    if (!items) return
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault()
        const file = item.getAsFile()
        if (!file) continue
        const reader = new FileReader()
        reader.onload = () => {
          const base64 = reader.result
          onPaste(base64, file.name || `paste-${Date.now()}.png`)
        }
        reader.readAsDataURL(file)
        break
      }
    }
  }, [onPaste])

  useEffect(() => {
    const el = cellRef.current
    if (el) {
      el.addEventListener('paste', handlePaste)
      return () => el.removeEventListener('paste', handlePaste)
    }
  }, [handlePaste])

  return (
    <div
      ref={cellRef}
      tabIndex={0}
      style={{ display: 'flex', gap: 4, flexWrap: 'wrap', minWidth: 140, minHeight: 50, outline: 'none', cursor: 'pointer' }}
      title="点击后按 Ctrl+V 粘贴图片"
    >
      {previewUrl && <ImagePreview src={previewUrl} onClose={() => setPreviewUrl(null)} />}
      {images.map((img, i) => (
        <div key={i} style={{ position: 'relative', width: 60, height: 60 }}>
          <img src={img.url} alt="" onClick={() => setPreviewUrl(img.url)}
            style={{ width: 60, height: 60, objectFit: 'cover', borderRadius: 4, border: '1px solid #e0e0e0', cursor: 'zoom-in' }}
            onError={(e) => { e.target.style.display = 'none' }} />
          <button
            onClick={(e) => { e.stopPropagation(); onRemove(i) }}
            style={{
              position: 'absolute', top: -4, right: -4, width: 18, height: 18, borderRadius: '50%',
              border: 'none', background: '#e74c3c', color: '#fff', fontSize: 11, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1
            }}>×</button>
        </div>
      ))}
      {images.length < maxCount && (
        <div style={{
          width: 60, height: 60, border: '1px dashed #999', borderRadius: 4,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 11, color: '#999'
        }}>
          Ctrl+V<br />粘贴
        </div>
      )}
    </div>
  )
}

// ── Inline editable cell ──
export function EditableCell({ value, onChange, type = 'text', placeholder = '' }) {
  const [editing, setEditing] = useState(false)
  const inputRef = useRef(null)
  const [localVal, setLocalVal] = useState(value ?? '')

  useEffect(() => { setLocalVal(value ?? '') }, [value])
  useEffect(() => { if (editing && inputRef.current) inputRef.current.focus() }, [editing])

  const handleBlur = () => {
    setEditing(false)
    if (localVal !== (value ?? '')) onChange(localVal)
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); inputRef.current?.blur() }
    if (e.key === 'Escape') { setLocalVal(value ?? ''); setEditing(false) }
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        type={type}
        value={localVal}
        onChange={e => setLocalVal(e.target.value)}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        style={{
          width: '100%', border: '1px solid #a78bfa', borderRadius: 4, padding: '2px 6px',
          fontSize: 13, outline: 'none', boxSizing: 'border-box', background: '#f8f6ff'
        }}
      />
    )
  }

  return (
    <div
      onClick={() => setEditing(true)}
      style={{
        minHeight: 24, cursor: 'text', padding: '2px 4px', borderRadius: 3,
        minWidth: 80, wordBreak: 'break-word',
        background: value ? 'transparent' : '#f5f5f5'
      }}
      title="点击编辑"
    >
      {value || <span style={{ color: '#bbb' }}>{placeholder || '点击输入'}</span>}
    </div>
  )
}

// ── Styled table header ──
export function Th({ children, style }) {
  return <th style={{ padding: '8px 6px', textAlign: 'left', fontWeight: 600, fontSize: 12, color: '#555', whiteSpace: 'nowrap', borderBottom: '2px solid #d0c8f0', ...style }}>{children}</th>
}

export const tdStyle = { padding: '6px 8px', verticalAlign: 'middle', borderBottom: '1px solid #f0f0f0' }

export const btnStyle = {
  primary: {
    padding: '6px 16px', borderRadius: 6, border: 'none', background: '#7c5cfc', color: '#fff',
    fontSize: 13, cursor: 'pointer', fontWeight: 500
  },
  secondary: {
    padding: '6px 16px', borderRadius: 6, border: '1px solid #d0d0d0', background: '#fff',
    fontSize: 13, cursor: 'pointer', color: '#555'
  },
  danger: {
    padding: '4px 10px', borderRadius: 4, border: 'none', background: '#fee2e2', color: '#dc2626',
    fontSize: 12, cursor: 'pointer'
  }
}