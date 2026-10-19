import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { QtyStepper } from '../src/ui/QtyStepper';

function Harness({ start = 0, addButton = true }: { start?: number; addButton?: boolean }) {
  const [qty, setQty] = useState(start);
  return (
    <>
      <QtyStepper value={qty} onChange={setQty} addButton={addButton} itemName="Teak" />
      <output data-testid="qty">{qty}</output>
    </>
  );
}

const qty = () => screen.getByTestId('qty').textContent;
const input = () => screen.getByRole('textbox', { name: 'Quantity' }) as HTMLInputElement;

afterEach(cleanup);

describe('QtyStepper', () => {
  it('Add becomes the stepper, and the stepper returns to Add at 0', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Add, Teak' }));
    expect(qty()).toBe('1');
    fireEvent.click(screen.getByRole('button', { name: 'Decrease quantity' }));
    expect(qty()).toBe('0');
    expect(screen.getByRole('button', { name: 'Add, Teak' })).toBeTruthy();
  });

  it('never goes below 0 without the Add button', () => {
    render(<Harness start={1} addButton={false} />);
    const minus = screen.getByRole('button', { name: 'Decrease quantity' }) as HTMLButtonElement;
    fireEvent.click(minus);
    expect(qty()).toBe('0');
    expect(minus.disabled).toBe(true);
    fireEvent.change(input(), { target: { value: '-4' } });
    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(qty()).toBe('0');
  });

  it('Enter commits a typed value; Escape and invalid text keep the old one', () => {
    render(<Harness start={5} />);
    fireEvent.change(input(), { target: { value: '250' } });
    expect(qty()).toBe('5');
    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(qty()).toBe('250');
    fireEvent.change(input(), { target: { value: '12' } });
    fireEvent.keyDown(input(), { key: 'Escape' });
    expect(input().value).toBe('250');
    fireEvent.change(input(), { target: { value: 'ten' } });
    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(qty()).toBe('250');
    expect(input().value).toBe('250');
  });

  it('blur commits too', () => {
    render(<Harness start={5} />);
    fireEvent.change(input(), { target: { value: '40' } });
    fireEvent.blur(input());
    expect(qty()).toBe('40');
  });

  it('shows +10 / +50 chips from 10 and steps by 10 from 100', () => {
    render(<Harness start={9} />);
    expect(screen.queryByRole('button', { name: 'Add 10 more' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Increase quantity' }));
    expect(qty()).toBe('10');
    fireEvent.click(screen.getByRole('button', { name: 'Add 50 more' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add 50 more' }));
    expect(qty()).toBe('110');
    fireEvent.click(screen.getByRole('button', { name: 'Increase quantity' }));
    expect(qty()).toBe('120');
    fireEvent.click(screen.getByRole('button', { name: 'Decrease quantity' }));
    expect(qty()).toBe('110');
  });
});
