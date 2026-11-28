import {readFile} from 'node:fs/promises';
import {scoreReceiptRows} from './receipt-dataset-score.ts';
import {parseReceipt} from '../src/domain/receipt.ts';

const [labelsPath,ocrPath]=process.argv.slice(2);
if(!labelsPath || !ocrPath)throw new Error('Usage: node scripts/score-receipt-dataset.mjs labels.json ocr.jsonl');
const labels=JSON.parse(await readFile(labelsPath,'utf8'));
const ocr=(await readFile(ocrPath,'utf8')).trim().split('\n').filter(Boolean).map(line=>JSON.parse(line));
const successful=ocr.filter(row=>typeof row.text==='string');
const rows=successful.map(row=>({id:row.id,suggestion:parseReceipt(row.text)}));
console.log(JSON.stringify({images:ocr.length,ocrErrors:ocr.length-successful.length,fields:scoreReceiptRows(labels,rows)},null,2));
