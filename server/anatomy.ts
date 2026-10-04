/** Shared, public educational catalogue. This file must remain browser-safe. */
export interface AnatomyGroup {
  key: string; nameZh: string; nameEn: string; ids: string[]; color: string;
  role: 'flexor' | 'extensor' | 'bone' | 'tendon'; description: string; sourceUrl: string;
  origin?: string; insertion?: string; meshSourceUrl?: string; additionalSources?: string[];
}
const atlas = 'https://github.com/ashemag/human-atlas';
const GROUPS: AnatomyGroup[] = [
  { key: 'biceps', nameZh: '肱二頭肌', nameEn: 'Biceps brachii', ids: ['FJ1478','FJ1512'], color: '#ff9363', role: 'flexor', description: '參與屈肘與前臂旋後。抬起、停留、放下時的實際作用仍取決於重力與外加負重；姿態不能直接量測活化。', sourceUrl: atlas },
  { key: 'triceps', nameZh: '肱三頭肌', nameEn: 'Triceps brachii', ids: ['FJ1477','FJ1479','FJ1480'], color: '#8a9cff', role: 'extensor', description: '主要參與伸肘。彎曲或伸直的方向不能單獨決定哪條肌肉正在出力。', sourceUrl: atlas },
  { key: 'brachialis', nameZh: '肱肌', nameEn: 'Brachialis', ids: ['FJ1486'], color: '#ffcf71', role: 'flexor', description: '位於肱二頭肌深層，參與屈肘。此處顏色表示解剖角色，不是肌電訊號或力的比例。', sourceUrl: atlas },
  { key: 'brachioradialis', nameZh: '肱橈肌', nameEn: 'Brachioradialis', ids: ['FJ1487'], color: '#6edbc3', role: 'flexor', description: '前臂肌肉，參與屈肘。單眼姿態不能確定肌肉活化強度。', sourceUrl: atlas },
  { key: 'humerus', nameZh: '肱骨', nameEn: 'Humerus', ids: ['FJ3368'], color: '#e4ded1', role: 'bone', description: '上臂骨；與橈骨、尺骨共同構成肘部關節結構。', sourceUrl: atlas },
  { key: 'radius', nameZh: '橈骨', nameEn: 'Radius', ids: ['FJ3349'], color: '#e4ded1', role: 'bone', description: '前臂拇指側的骨。肱二頭肌遠端肌腱連至橈骨。', sourceUrl: atlas },
  { key: 'ulna', nameZh: '尺骨', nameEn: 'Ulna', ids: ['FJ3391'], color: '#e4ded1', role: 'bone', description: '前臂小指側的骨。肱三頭肌肌腱連至尺骨鷹嘴。', sourceUrl: atlas },
  { key: 'biceps-tendon', nameZh: '肱二頭肌遠端肌腱（示意）', nameEn: 'Distal biceps tendon — schematic', ids: ['tendon-biceps-distal'], color: '#77d9e7', role: 'tendon', description: '由應用程式繪製的連結示意，連接肱二頭肌與橈骨；不是來源模型的真實肌腱網格，也不是受力估計。', sourceUrl: atlas },
  { key: 'triceps-tendon', nameZh: '肱三頭肌遠端肌腱（示意）', nameEn: 'Distal triceps tendon — schematic', ids: ['tendon-triceps-distal'], color: '#77d9e7', role: 'tendon', description: '由應用程式繪製的連結示意，連接肱三頭肌與尺骨鷹嘴；不是來源模型的真實肌腱網格，也不是受力估計。', sourceUrl: atlas },
];
const attachments: Record<string, Pick<AnatomyGroup, 'origin' | 'insertion' | 'additionalSources'>> = {
  biceps: { origin: '長頭：肩胛骨盂上結節；短頭：肩胛骨喙突', insertion: '橈骨粗隆；另有腱膜延伸至前臂筋膜', additionalSources: ['https://nervesurgery.wustl.edu/biceps-brachii/'] },
  triceps: { origin: '長頭：肩胛骨盂下結節；其餘兩頭：肱骨後側', insertion: '尺骨鷹嘴' },
  brachialis: { origin: '肱骨前面遠端半部及肌間隔', insertion: '尺骨粗隆與冠狀突', additionalSources: ['https://nervesurgery.wustl.edu/brachialis/'] },
  brachioradialis: { origin: '肱骨外側髁上脊', insertion: '橈骨莖突基部' },
};
export const ANATOMY_GROUPS: AnatomyGroup[] = GROUPS.map(group => ({ ...group, meshSourceUrl: atlas,
  ...(attachments[group.key] ? { ...attachments[group.key], sourceUrl: 'https://openstax.org/books/anatomy-and-physiology-2e/pages/11-5-muscles-of-the-pectoral-girdle-and-upper-limbs' } : {}),
}));
export const ANATOMY_IDS = ANATOMY_GROUPS.flatMap(group => group.ids);
export function getAnatomyInfo(ids: string[]) {
  return ANATOMY_GROUPS.filter(group => group.ids.some(id => ids.includes(id)));
}
