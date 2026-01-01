'use client'

import { useState, useRef, useEffect } from 'react'

interface Option {
  value: string | number
  label: string
}

interface PixelSelectProps {
  options: Option[]
  value: string | number
  onChange: (value: string | number) => void
  className?: string
}

export function PixelSelect({ options, value, onChange, className = '' }: PixelSelectProps) {
  const [isOpen, setIsOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const selectedOption = options.find(opt => opt.value === value)

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleSelect = (optionValue: string | number) => {
    onChange(optionValue)
    setIsOpen(false)
  }

  return (
    <div ref={ref} className={`pixel-select ${className}`}>
      <button
        type="button"
        className={`pixel-select-trigger ${isOpen ? 'open' : ''}`}
        onClick={() => setIsOpen(!isOpen)}
      >
        <span>{selectedOption?.label || 'Select...'}</span>
        <span className="pixel-select-arrow">{isOpen ? '▲' : '▼'}</span>
      </button>

      {isOpen && (
        <div className="pixel-select-dropdown">
          {options.map((option) => (
            <div
              key={option.value}
              className={`pixel-select-option ${option.value === value ? 'selected' : ''}`}
              onClick={() => handleSelect(option.value)}
            >
              {option.value === value && <span className="pixel-select-check">►</span>}
              {option.label}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
