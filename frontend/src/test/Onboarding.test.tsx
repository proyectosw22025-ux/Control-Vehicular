import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import Onboarding from '../components/Onboarding'

const STORAGE_KEY = 'onboarding_completado'

beforeEach(() => {
  localStorage.clear()
})

describe('Onboarding', () => {
  it('se muestra en el primer login (sin clave en localStorage)', () => {
    render(<Onboarding />)
    expect(screen.getByText(/Bienvenido/i)).toBeInTheDocument()
  })

  it('NO se muestra si ya fue completado', () => {
    localStorage.setItem(STORAGE_KEY, '1')
    render(<Onboarding />)
    expect(screen.queryByText(/Bienvenido/i)).toBeNull()
  })

  it('avanza al paso siguiente al hacer clic en Siguiente', () => {
    render(<Onboarding />)
    fireEvent.click(screen.getByText('Siguiente'))
    expect(screen.getByText('Gestión de Vehículos')).toBeInTheDocument()
  })

  it('el botón Anterior regresa al paso previo', () => {
    render(<Onboarding />)
    fireEvent.click(screen.getByText('Siguiente'))
    fireEvent.click(screen.getByText('Anterior'))
    expect(screen.getByText(/Bienvenido/i)).toBeInTheDocument()
  })

  it('el último paso muestra el botón Comenzar', () => {
    render(<Onboarding />)
    // Avanzar hasta el último paso (4 pasos en total)
    fireEvent.click(screen.getByText('Siguiente'))
    fireEvent.click(screen.getByText('Siguiente'))
    fireEvent.click(screen.getByText('Siguiente'))
    expect(screen.getByText('Comenzar')).toBeInTheDocument()
  })

  it('al hacer clic en Comenzar guarda la clave y cierra el modal', () => {
    render(<Onboarding />)
    fireEvent.click(screen.getByText('Siguiente'))
    fireEvent.click(screen.getByText('Siguiente'))
    fireEvent.click(screen.getByText('Siguiente'))
    fireEvent.click(screen.getByText('Comenzar'))
    expect(localStorage.getItem(STORAGE_KEY)).toBe('1')
    expect(screen.queryByText('Comenzar')).toBeNull()
  })

  it('el botón X cierra el modal y guarda la clave', () => {
    render(<Onboarding />)
    fireEvent.click(screen.getByTitle('Cerrar y no mostrar de nuevo'))
    expect(localStorage.getItem(STORAGE_KEY)).toBe('1')
    expect(screen.queryByText(/Bienvenido/i)).toBeNull()
  })

  it('muestra el indicador de progreso correcto (Paso X de 4)', () => {
    render(<Onboarding />)
    expect(screen.getByText('Paso 1 de 4')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Siguiente'))
    expect(screen.getByText('Paso 2 de 4')).toBeInTheDocument()
  })
})
