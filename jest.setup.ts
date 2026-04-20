// Extends Jest's `expect` with DOM-specific matchers like toBeInTheDocument,
// toHaveAttribute, toHaveTextContent, etc. Imported once globally via
// jest.config's setupFilesAfterEach option.
import '@testing-library/jest-dom'
