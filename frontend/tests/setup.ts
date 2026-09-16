import '@testing-library/jest-dom/vitest';
// jsdom has no IndexedDB, which offlineQueue.ts depends on.
import 'fake-indexeddb/auto';
