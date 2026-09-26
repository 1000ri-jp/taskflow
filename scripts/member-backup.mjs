import { Timestamp, GeoPoint } from 'firebase-admin/firestore';
// Tagged values preserve Firestore types and cannot collide with user map keys.
export function encodeMemberValue(value) {
  if (value instanceof Timestamp) return { type: 'timestamp', seconds: value.seconds, nanoseconds: value.nanoseconds };
  if (value instanceof GeoPoint) return { type: 'geopoint', latitude: value.latitude, longitude: value.longitude };
  if (Buffer.isBuffer(value)) return { type: 'bytes', value: value.toString('base64') };
  if (Array.isArray(value)) return { type: 'array', value: value.map(encodeMemberValue) };
  if (value && typeof value === 'object') {
    if (Object.getPrototypeOf(value) !== Object.prototype) throw new Error('Unsupported member value; backup needs review.');
    return { type: 'map', value: Object.fromEntries(Object.entries(value).map(([key, item]) => [key, encodeMemberValue(item)])) };
  }
  if (value === undefined || (typeof value === 'number' && !Number.isFinite(value))) throw new Error('Unsupported member value');
  return { type: 'primitive', value };
}
export function decodeMemberValue(encoded) {
  switch (encoded.type) {
    case 'timestamp': return new Timestamp(encoded.seconds, encoded.nanoseconds);
    case 'geopoint': return new GeoPoint(encoded.latitude, encoded.longitude);
    case 'bytes': return Buffer.from(encoded.value, 'base64');
    case 'array': return encoded.value.map(decodeMemberValue);
    case 'map': return Object.fromEntries(Object.entries(encoded.value).map(([key, value]) => [key, decodeMemberValue(value)]));
    case 'primitive': return encoded.value;
    default: throw new Error('Unknown backup type');
  }
}
