import { render, screen } from '@testing-library/react';
import App from './App';

test('renders Gravity Curve title', () => {
  render(<App />);
  const title = screen.getByText(/Gravity Curve/i);
  expect(title).toBeInTheDocument();
});
