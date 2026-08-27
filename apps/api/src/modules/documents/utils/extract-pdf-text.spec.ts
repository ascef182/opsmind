const mockGetText = jest.fn();
const mockDestroy = jest.fn();

jest.mock('pdf-parse', () => ({
  PDFParse: jest.fn().mockImplementation(() => ({
    getText: mockGetText,
    destroy: mockDestroy,
  })),
}));

import { PDFParse } from 'pdf-parse';
import { extractPdfText } from './extract-pdf-text';

describe('extractPdfText', () => {
  beforeEach(() => {
    mockGetText.mockReset();
    mockDestroy.mockReset();
    (PDFParse as unknown as jest.Mock).mockClear();
  });

  it('extrai o texto do PDF a partir do buffer e libera os recursos do parser', async () => {
    mockGetText.mockResolvedValue({ text: 'Cláusula 1: rescisão em 30 dias.', total: 1 });
    const buffer = Buffer.from('%PDF-1.4 fake bytes');

    const text = await extractPdfText(buffer);

    expect(text).toBe('Cláusula 1: rescisão em 30 dias.');
    expect(PDFParse).toHaveBeenCalledWith({ data: buffer });
    expect(mockDestroy).toHaveBeenCalledTimes(1);
  });

  it('ainda libera os recursos do parser quando a extração falha', async () => {
    mockGetText.mockRejectedValue(new Error('PDF corrompido'));
    const buffer = Buffer.from('not really a pdf');

    await expect(extractPdfText(buffer)).rejects.toThrow('PDF corrompido');
    expect(mockDestroy).toHaveBeenCalledTimes(1);
  });
});
