export { OptikKernel } from './kernel';
export type { CaptureOptions, EvaluationResult, KernelEvents, KernelOptions } from './kernel';

export { LogDomain } from './domains/log';
export type { LogDomainEvents, LogDomainOptions, IngestOptions } from './domains/log';
export { NetworkDomain } from './domains/network';
export type { NetworkDomainEvents, NetworkDomainOptions } from './domains/network';
export { StorageDomain } from './domains/storage';
export type { StorageAreaStatus } from './domains/storage';
export { SystemDomain, readSafeArea } from './domains/system';

export { Emitter } from './emitter';
export type { Listener, Unsubscribe } from './emitter';
export { RingBuffer } from './ring-buffer';

export {
  ObjectRegistry,
  toRemoteObject,
  getProperties,
  DEFAULT_PREVIEW_LIMITS,
} from './remote-object';
export type {
  EntryPreview,
  GetPropertiesOptions,
  ObjectPreview,
  PreviewLimits,
  PropertyDescriptor,
  PropertyPreview,
  RemoteObject,
  RemoteObjectSubtype,
  RemoteObjectType,
} from './remote-object';

export { flattenToText, remoteObjectToText, sanitizeCss, hasFormatSpecifier } from './format';

export * from './types';
export * from './protocol';

export { instrumentConsole } from './instrument/console';
export type { ConsoleMethod, ConsoleRecord, ConsoleSink } from './instrument/console';
export { instrumentErrors } from './instrument/errors';
export { captureStack, parseStack } from './instrument/stack';
export { byteLengthOf, mimeTypeOf, isTextualMime, splitUrl } from './instrument/body';
export type { Instrumentation, NetworkSink } from './instrument/xhr';
