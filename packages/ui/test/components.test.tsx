import { paise } from '@ecomkit/core/money';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Price, Rating, uiMessages } from '../src';
import manifest from '../src/manifest';
import { FormField } from '../src/ui/FormField';
import { Input } from '../src/ui/Input';

afterEach(cleanup);

describe('Price', () => {
  it('formats en-IN and strikes only a higher compare-at', () => {
    const { container, rerender } = render(<Price paise={paise(124999)} compareAtPaise={paise(150000)} />);
    expect(container.textContent).toContain('1,24,999');
    expect(container.querySelector('s')?.textContent).toContain('1,50,000');
    rerender(<Price paise={paise(249)} compareAtPaise={paise(199)} />);
    expect(container.querySelector('s')).toBeNull();
  });
});

describe('Rating', () => {
  it('shows "New" under 3 reviews and stars from 3', () => {
    const { rerender } = render(<Rating average={5} count={2} />);
    expect(screen.getByText(uiMessages.rating.newChip)).toBeTruthy();
    rerender(<Rating average={4.56} count={3} />);
    expect(screen.getByRole('img', { name: 'Rated 4.6 out of 5 from 3 reviews' })).toBeTruthy();
  });
});

describe('FormField', () => {
  it('wires label, help and error to the control', () => {
    render(
      <FormField id="ph" label="Phone" help="10 digits" error="Required">
        {(p) => <Input {...p} />}
      </FormField>,
    );
    const el = screen.getByLabelText('Phone');
    expect(el.getAttribute('aria-describedby')).toBe('ph-help ph-error');
    expect(el.getAttribute('aria-invalid')).toBe('true');
  });
});

describe('manifest', () => {
  it('declares only the stories admin page', () => {
    expect(manifest.id).toBe('ui');
    expect(manifest.admin.pages.map((p) => p.path)).toEqual(['/admin/dev/ui']);
  });
});
