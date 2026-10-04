import { describe, it, expect } from 'vitest';
import { listSubjects, listCatalog, getSubjectDetails } from '../src/utils/notesLoader';

describe('Dynamic Subject Metadata Loader', () => {
  it('loads subjects with subject.json metadata via listSubjects', async () => {
    const subjects = await listSubjects();
    expect(subjects.length).toBeGreaterThanOrEqual(15);

    const cv = subjects.find((s) => s.name === 'Computer Vision');
    expect(cv).toBeDefined();
    expect(cv?.shortName).toBe('CV');
    expect(cv?.semester).toBe(2);
    expect(cv?.order).toBe(11);
    expect(cv?.code).toBe('CV');
    expect(cv?.description).toContain('Image formation');
  });

  it('includes subject metadata in listCatalog', async () => {
    const catalog = await listCatalog();
    expect(catalog.length).toBeGreaterThanOrEqual(15);

    const cv = catalog.find((s) => s.subject === 'Computer Vision');
    expect(cv).toBeDefined();
    expect(cv?.semester).toBe(2);
    expect(cv?.shortName).toBe('CV');
    expect(cv?.code).toBe('CV');
  });

  it('retrieves detailed subject info using getSubjectDetails by name and slug', async () => {
    const byName = await getSubjectDetails('Computer Vision');
    expect(byName.name).toBe('Computer Vision');
    expect(byName.semester).toBe(2);
    expect(byName.shortName).toBe('CV');
    expect(byName.code).toBe('CV');

    const bySlug = await getSubjectDetails('computer-vision');
    expect(bySlug.name).toBe('Computer Vision');
    expect(bySlug.semester).toBe(2);
    expect(bySlug.shortName).toBe('CV');
  });
});
