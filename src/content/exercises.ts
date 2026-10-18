/**
 * 健身动作目录。
 *
 * 名称、要领是中文手写的；肌群、器械、难度来自 free-exercise-db
 * （https://github.com/yuhonas/free-exercise-db ，Unlicense / 公有领域），
 * 图片也来自该数据集，已下载到 public/exercises/<id>/0.webp 与 1.webp。
 *
 * 这是内容文件不是逻辑文件：加一个动作 = 在这里加一条 + 放两张图，
 * 不需要改任何组件。
 */
import type { Muscle } from 'react-body-highlighter';

/** 无氧的四个部位，顺序就是页面上分组的顺序 */
export const BODY_PARTS = ['胸', '肩', '背', '腿'] as const;
export type BodyPart = (typeof BODY_PARTS)[number];

export interface Exercise {
  /** 数据集里的动作 id，同时也是图片目录名 */
  id: string;
  /** 中文名，页面上显示的就是它 */
  name: string;
  /** 英文原名，只在需要对照数据集时用 */
  en: string;
  part: BodyPart;
  /** 中文器械名 */
  equipment: string;
  level: '入门' | '进阶';
  /** 主要发力肌群的中文名，用于文字标签 */
  primary: string[];
  /** 人体图上高亮成亮红的肌群 */
  muscles: Muscle[];
  /** 人体图上高亮成暗红的肌群 */
  secondary: Muscle[];
  /** [要领, 常见错误] */
  tips: [string, string];
}

export interface CardioActivity {
  id: string;
  name: string;
  en: string;
  level: '入门' | '进阶';
  /** [要领, 常见错误] */
  tips: [string, string];
}

/** 无氧动作，按部位分组用 exercisesOfPart() */
export const EXERCISES: Exercise[] = [
  {
    "id": "Barbell_Bench_Press_-_Medium_Grip",
    "name": "杠铃卧推",
    "en": "Barbell Bench Press - Medium Grip",
    "part": "胸",
    "equipment": "杠铃",
    "level": "入门",
    "primary": [
      "胸大肌"
    ],
    "muscles": [
      "chest"
    ],
    "secondary": [
      "front-deltoids",
      "back-deltoids",
      "triceps"
    ],
    "tips": [
      "肩胛往下压、夹紧再起杠，杠铃落点在乳头连线上方一点",
      "别让肩膀向前顶起来，也别把杠弹胸借力"
    ]
  },
  {
    "id": "Barbell_Incline_Bench_Press_-_Medium_Grip",
    "name": "上斜杠铃卧推",
    "en": "Barbell Incline Bench Press - Medium Grip",
    "part": "胸",
    "equipment": "杠铃",
    "level": "入门",
    "primary": [
      "胸大肌"
    ],
    "muscles": [
      "chest"
    ],
    "secondary": [
      "front-deltoids",
      "back-deltoids",
      "triceps"
    ],
    "tips": [
      "凳面 30° 左右最有效，杠铃落在锁骨下方",
      "角度超过 45° 就变成练前束了"
    ]
  },
  {
    "id": "Decline_Barbell_Bench_Press",
    "name": "下斜杠铃卧推",
    "en": "Decline Barbell Bench Press",
    "part": "胸",
    "equipment": "杠铃",
    "level": "入门",
    "primary": [
      "胸大肌"
    ],
    "muscles": [
      "chest"
    ],
    "secondary": [
      "front-deltoids",
      "back-deltoids",
      "triceps"
    ],
    "tips": [
      "固定住腿和背，杠铃落到下胸",
      "别为了重量把臀抬离凳面"
    ]
  },
  {
    "id": "Wide-Grip_Barbell_Bench_Press",
    "name": "宽握杠铃卧推",
    "en": "Wide-Grip Barbell Bench Press",
    "part": "胸",
    "equipment": "杠铃",
    "level": "进阶",
    "primary": [
      "胸大肌"
    ],
    "muscles": [
      "chest"
    ],
    "secondary": [
      "front-deltoids",
      "back-deltoids",
      "triceps"
    ],
    "tips": [
      "握距约 1.5 倍肩宽，能把胸拉开更大行程",
      "太宽会压手腕和肩关节，别超过 2 倍肩宽"
    ]
  },
  {
    "id": "Dumbbell_Bench_Press",
    "name": "哑铃卧推",
    "en": "Dumbbell Bench Press",
    "part": "胸",
    "equipment": "哑铃",
    "level": "入门",
    "primary": [
      "胸大肌"
    ],
    "muscles": [
      "chest"
    ],
    "secondary": [
      "front-deltoids",
      "back-deltoids",
      "triceps"
    ],
    "tips": [
      "哑铃下放到底让胸有牵拉感，两个哑铃在顶端靠近但不碰",
      "下放太浅等于白练，行程要够"
    ]
  },
  {
    "id": "Incline_Dumbbell_Press",
    "name": "上斜哑铃卧推",
    "en": "Incline Dumbbell Press",
    "part": "胸",
    "equipment": "哑铃",
    "level": "入门",
    "primary": [
      "胸大肌"
    ],
    "muscles": [
      "chest"
    ],
    "secondary": [
      "front-deltoids",
      "back-deltoids",
      "triceps"
    ],
    "tips": [
      "哑铃比杠铃能下得更深，注意肘别掉太低",
      "别把哑铃在顶端撞在一起卸力"
    ]
  },
  {
    "id": "Dumbbell_Flyes",
    "name": "哑铃飞鸟",
    "en": "Dumbbell Flyes",
    "part": "胸",
    "equipment": "哑铃",
    "level": "入门",
    "primary": [
      "胸大肌"
    ],
    "muscles": [
      "chest"
    ],
    "secondary": [],
    "tips": [
      "手肘保持一个固定的小角度，像抱一棵大树",
      "肘部绷直会让肘关节硬扛，重量要降"
    ]
  },
  {
    "id": "Cable_Crossover",
    "name": "绳索夹胸",
    "en": "Cable Crossover",
    "part": "胸",
    "equipment": "绳索",
    "level": "入门",
    "primary": [
      "胸大肌"
    ],
    "muscles": [
      "chest"
    ],
    "secondary": [
      "front-deltoids",
      "back-deltoids"
    ],
    "tips": [
      "身体前倾、肘微屈，双手在身前交汇时用力收胸",
      "别用手臂划弧线，重量只是给你张力的"
    ]
  },
  {
    "id": "Butterfly",
    "name": "蝴蝶机夹胸",
    "en": "Butterfly",
    "part": "胸",
    "equipment": "器械",
    "level": "入门",
    "primary": [
      "胸大肌"
    ],
    "muscles": [
      "chest"
    ],
    "secondary": [],
    "tips": [
      "坐到位让手柄和胸口齐平，收的时候停一秒",
      "弹回来太快，离心阶段才是长肌肉的地方"
    ]
  },
  {
    "id": "Machine_Bench_Press",
    "name": "器械推胸",
    "en": "Machine Bench Press",
    "part": "胸",
    "equipment": "器械",
    "level": "入门",
    "primary": [
      "胸大肌"
    ],
    "muscles": [
      "chest"
    ],
    "secondary": [
      "front-deltoids",
      "back-deltoids",
      "triceps"
    ],
    "tips": [
      "先调好座椅让手柄在胸口位置，再上重量",
      "别把器械当沙发，腰背要贴紧"
    ]
  },
  {
    "id": "Pushups",
    "name": "俯卧撑",
    "en": "Pushups",
    "part": "胸",
    "equipment": "自重",
    "level": "入门",
    "primary": [
      "胸大肌"
    ],
    "muscles": [
      "chest"
    ],
    "secondary": [
      "front-deltoids",
      "back-deltoids",
      "triceps"
    ],
    "tips": [
      "身体从头到脚一条直线，胸口贴到接近地面",
      "塌腰翘臀都很常见，先减少次数保证质量"
    ]
  },
  {
    "id": "Incline_Push-Up",
    "name": "上斜俯卧撑",
    "en": "Incline Push-Up",
    "part": "胸",
    "equipment": "自重",
    "level": "入门",
    "primary": [
      "胸大肌"
    ],
    "muscles": [
      "chest"
    ],
    "secondary": [
      "front-deltoids",
      "back-deltoids",
      "triceps"
    ],
    "tips": [
      "手撑在台阶或凳面上，脚越高越难",
      "位置太高就只是手臂在动，胸没吃到力"
    ]
  },
  {
    "id": "Push-Up_Wide",
    "name": "宽距俯卧撑",
    "en": "Push-Up Wide",
    "part": "胸",
    "equipment": "自重",
    "level": "入门",
    "primary": [
      "胸大肌"
    ],
    "muscles": [
      "chest"
    ],
    "secondary": [
      "abs",
      "front-deltoids",
      "back-deltoids",
      "triceps"
    ],
    "tips": [
      "手放得比肩宽，能更多刺激胸的外侧",
      "手太宽会拉伤肩，循序渐进"
    ]
  },
  {
    "id": "Dips_-_Chest_Version",
    "name": "双杠臂屈伸",
    "en": "Dips - Chest Version",
    "part": "胸",
    "equipment": "双杠/其他",
    "level": "进阶",
    "primary": [
      "胸大肌"
    ],
    "muscles": [
      "chest"
    ],
    "secondary": [
      "front-deltoids",
      "back-deltoids",
      "triceps"
    ],
    "tips": [
      "身体前倾、肘略微外张，蹲到底再撑起",
      "身体太直立就变成练三头了"
    ]
  },
  {
    "id": "Seated_Barbell_Military_Press",
    "name": "坐姿杠铃推举",
    "en": "Seated Barbell Military Press",
    "part": "肩",
    "equipment": "杠铃",
    "level": "进阶",
    "primary": [
      "三角肌"
    ],
    "muscles": [
      "front-deltoids",
      "back-deltoids"
    ],
    "secondary": [
      "triceps"
    ],
    "tips": [
      "核心收紧、肋骨别外翻，杠铃沿面部前方推起",
      "别为了过顶把腰反弓到底"
    ]
  },
  {
    "id": "Standing_Military_Press",
    "name": "站姿杠铃推举",
    "en": "Standing Military Press",
    "part": "肩",
    "equipment": "杠铃",
    "level": "入门",
    "primary": [
      "三角肌"
    ],
    "muscles": [
      "front-deltoids",
      "back-deltoids"
    ],
    "secondary": [
      "triceps"
    ],
    "tips": [
      "站姿对核心要求更高，臀部和腹部全程绷住",
      "腰一松杠铃就变成上斜卧推了"
    ]
  },
  {
    "id": "Dumbbell_Shoulder_Press",
    "name": "哑铃推举",
    "en": "Dumbbell Shoulder Press",
    "part": "肩",
    "equipment": "哑铃",
    "level": "进阶",
    "primary": [
      "三角肌"
    ],
    "muscles": [
      "front-deltoids",
      "back-deltoids"
    ],
    "secondary": [
      "triceps"
    ],
    "tips": [
      "起始时哑铃与耳齐平，推起时走一条微微向内的弧线",
      "别把哑铃在头顶砸在一起"
    ]
  },
  {
    "id": "Seated_Dumbbell_Press",
    "name": "坐姿哑铃推举",
    "en": "Seated Dumbbell Press",
    "part": "肩",
    "equipment": "哑铃",
    "level": "入门",
    "primary": [
      "三角肌"
    ],
    "muscles": [
      "front-deltoids",
      "back-deltoids"
    ],
    "secondary": [
      "triceps"
    ],
    "tips": [
      "靠背调到接近竖直，能更好地隔离三角肌",
      "靠背后仰太多就变成上胸了"
    ]
  },
  {
    "id": "Arnold_Dumbbell_Press",
    "name": "阿诺德推举",
    "en": "Arnold Dumbbell Press",
    "part": "肩",
    "equipment": "哑铃",
    "level": "进阶",
    "primary": [
      "三角肌"
    ],
    "muscles": [
      "front-deltoids",
      "back-deltoids"
    ],
    "secondary": [
      "triceps"
    ],
    "tips": [
      "起始掌心朝自己，推起时边推边旋到掌心朝前",
      "旋转不流畅就先减重量"
    ]
  },
  {
    "id": "Machine_Shoulder_Military_Press",
    "name": "器械肩推",
    "en": "Machine Shoulder (Military) Press",
    "part": "肩",
    "equipment": "器械",
    "level": "入门",
    "primary": [
      "三角肌"
    ],
    "muscles": [
      "front-deltoids",
      "back-deltoids"
    ],
    "secondary": [
      "triceps"
    ],
    "tips": [
      "适合新手找发力感和最后力竭，椅背调到手腕略低于肩",
      "别用惯性甩起来，慢慢放回去"
    ]
  },
  {
    "id": "Side_Lateral_Raise",
    "name": "侧平举",
    "en": "Side Lateral Raise",
    "part": "肩",
    "equipment": "哑铃",
    "level": "入门",
    "primary": [
      "三角肌"
    ],
    "muscles": [
      "front-deltoids",
      "back-deltoids"
    ],
    "secondary": [],
    "tips": [
      "沉肩、手肘微屈，抬到手与肩平就够",
      "耸肩借力最常见，重量宁可小"
    ]
  },
  {
    "id": "Front_Dumbbell_Raise",
    "name": "前平举",
    "en": "Front Dumbbell Raise",
    "part": "肩",
    "equipment": "哑铃",
    "level": "入门",
    "primary": [
      "三角肌"
    ],
    "muscles": [
      "front-deltoids",
      "back-deltoids"
    ],
    "secondary": [],
    "tips": [
      "交替抬起，抬到与肩平行即可",
      "抬过头会让斜方肌接管"
    ]
  },
  {
    "id": "Reverse_Flyes",
    "name": "俯身哑铃飞鸟",
    "en": "Reverse Flyes",
    "part": "肩",
    "equipment": "哑铃",
    "level": "入门",
    "primary": [
      "三角肌"
    ],
    "muscles": [
      "front-deltoids",
      "back-deltoids"
    ],
    "secondary": [],
    "tips": [
      "俯身到接近水平，肘微屈，把哑铃向两侧打开",
      "重量太大就变成划船了"
    ]
  },
  {
    "id": "Face_Pull",
    "name": "面拉",
    "en": "Face Pull",
    "part": "肩",
    "equipment": "绳索",
    "level": "进阶",
    "primary": [
      "三角肌"
    ],
    "muscles": [
      "front-deltoids",
      "back-deltoids"
    ],
    "secondary": [
      "upper-back",
      "lower-back"
    ],
    "tips": [
      "绳索调到脸的高度，拉向面部时手肘打开，肩胛后收",
      "这是练后束和肩健康的动作，别上大重量"
    ]
  },
  {
    "id": "Cable_Rope_Rear-Delt_Rows",
    "name": "绳索后束划船",
    "en": "Cable Rope Rear-Delt Rows",
    "part": "肩",
    "equipment": "绳索",
    "level": "入门",
    "primary": [
      "三角肌"
    ],
    "muscles": [
      "front-deltoids",
      "back-deltoids"
    ],
    "secondary": [
      "biceps",
      "upper-back",
      "lower-back"
    ],
    "tips": [
      "身体略前倾，把绳索拉向胸口并向外打开手肘",
      "别靠躯干晃动来帮忙"
    ]
  },
  {
    "id": "Upright_Barbell_Row",
    "name": "直立划船",
    "en": "Upright Barbell Row",
    "part": "肩",
    "equipment": "杠铃",
    "level": "入门",
    "primary": [
      "三角肌"
    ],
    "muscles": [
      "front-deltoids",
      "back-deltoids"
    ],
    "secondary": [
      "trapezius"
    ],
    "tips": [
      "握距略宽于肩，拉到胸口高度就停",
      "拉太高会夹肩，肩不舒服就换成绳索"
    ]
  },
  {
    "id": "Barbell_Rear_Delt_Row",
    "name": "俯身杠铃提拉",
    "en": "Barbell Rear Delt Row",
    "part": "肩",
    "equipment": "杠铃",
    "level": "入门",
    "primary": [
      "三角肌"
    ],
    "muscles": [
      "front-deltoids",
      "back-deltoids"
    ],
    "secondary": [
      "biceps",
      "upper-back",
      "lower-back"
    ],
    "tips": [
      "上身前倾约 45°，用肘带路把杠铃提到腹部",
      "别用腰一下一下地弹"
    ]
  },
  {
    "id": "Bent_Over_Low-Pulley_Side_Lateral",
    "name": "俯身绳索侧平举",
    "en": "Bent Over Low-Pulley Side Lateral",
    "part": "肩",
    "equipment": "绳索",
    "level": "入门",
    "primary": [
      "三角肌"
    ],
    "muscles": [
      "front-deltoids",
      "back-deltoids"
    ],
    "secondary": [
      "lower-back",
      "upper-back",
      "trapezius"
    ],
    "tips": [
      "滑轮调低、身体前倾，单臂向外侧抬起",
      "别耸肩，注意是肩在动不是手臂"
    ]
  },
  {
    "id": "Barbell_Deadlift",
    "name": "硬拉",
    "en": "Barbell Deadlift",
    "part": "背",
    "equipment": "杠铃",
    "level": "进阶",
    "primary": [
      "竖脊肌"
    ],
    "muscles": [
      "lower-back"
    ],
    "secondary": [
      "calves",
      "forearm",
      "gluteal",
      "hamstring",
      "upper-back",
      "quadriceps",
      "trapezius"
    ],
    "tips": [
      "杠铃贴着小腿起，先蹬地再伸髋，全程背部平直",
      "弓背起大重量是腰伤头号原因，宁可减重量"
    ]
  },
  {
    "id": "Rack_Pulls",
    "name": "架上拉",
    "en": "Rack Pulls",
    "part": "背",
    "equipment": "杠铃",
    "level": "进阶",
    "primary": [
      "竖脊肌"
    ],
    "muscles": [
      "lower-back"
    ],
    "secondary": [
      "forearm",
      "gluteal",
      "hamstring",
      "trapezius"
    ],
    "tips": [
      "把杠放在膝上高度练锁定，能安全地上更大的重量",
      "别用腰甩，仍然要靠臀腿和背一起完成"
    ]
  },
  {
    "id": "Bent_Over_Barbell_Row",
    "name": "杠铃划船",
    "en": "Bent Over Barbell Row",
    "part": "背",
    "equipment": "杠铃",
    "level": "入门",
    "primary": [
      "中背"
    ],
    "muscles": [
      "upper-back",
      "lower-back"
    ],
    "secondary": [
      "biceps",
      "front-deltoids",
      "back-deltoids"
    ],
    "tips": [
      "上身前倾 45°~90°，把杠拉向小腹，肘向后走",
      "腰酸说明重量过头或者上身前倾不够"
    ]
  },
  {
    "id": "T-Bar_Row_with_Handle",
    "name": "T杠划船",
    "en": "T-Bar Row with Handle",
    "part": "背",
    "equipment": "杠铃",
    "level": "入门",
    "primary": [
      "中背"
    ],
    "muscles": [
      "upper-back",
      "lower-back"
    ],
    "secondary": [
      "biceps"
    ],
    "tips": [
      "胸口顶住垫子能减少腰部压力，把杠拉向下腹",
      "别靠起身的惯性把重量甩上去"
    ]
  },
  {
    "id": "Bent_Over_Two-Dumbbell_Row",
    "name": "俯身双哑铃划船",
    "en": "Bent Over Two-Dumbbell Row",
    "part": "背",
    "equipment": "哑铃",
    "level": "入门",
    "primary": [
      "中背"
    ],
    "muscles": [
      "upper-back",
      "lower-back"
    ],
    "secondary": [
      "biceps",
      "front-deltoids",
      "back-deltoids"
    ],
    "tips": [
      "背平直、膝微屈，两臂同时向后拉",
      "手肘张太开就练成后束了"
    ]
  },
  {
    "id": "One-Arm_Dumbbell_Row",
    "name": "单臂哑铃划船",
    "en": "One-Arm Dumbbell Row",
    "part": "背",
    "equipment": "哑铃",
    "level": "入门",
    "primary": [
      "中背"
    ],
    "muscles": [
      "upper-back",
      "lower-back"
    ],
    "secondary": [
      "biceps",
      "front-deltoids",
      "back-deltoids"
    ],
    "tips": [
      "单侧练能补左右不平衡，把哑铃拉向髋部",
      "别甩腰，肩膀要跟着下沉"
    ]
  },
  {
    "id": "Pullups",
    "name": "引体向上",
    "en": "Pullups",
    "part": "背",
    "equipment": "自重",
    "level": "入门",
    "primary": [
      "背阔肌"
    ],
    "muscles": [
      "upper-back"
    ],
    "secondary": [
      "biceps",
      "lower-back"
    ],
    "tips": [
      "起始就沉肩，想着用肘往下拉而不是用手臂",
      "半程摆动不止没用还容易伤肩"
    ]
  },
  {
    "id": "Chin-Up",
    "name": "反握引体向上",
    "en": "Chin-Up",
    "part": "背",
    "equipment": "自重",
    "level": "入门",
    "primary": [
      "背阔肌"
    ],
    "muscles": [
      "upper-back"
    ],
    "secondary": [
      "biceps",
      "forearm",
      "lower-back"
    ],
    "tips": [
      "掌心朝自己，二头参与更多，是引体的入门版本",
      "别蹬腿借力"
    ]
  },
  {
    "id": "Wide-Grip_Lat_Pulldown",
    "name": "宽距高位下拉",
    "en": "Wide-Grip Lat Pulldown",
    "part": "背",
    "equipment": "绳索",
    "level": "入门",
    "primary": [
      "背阔肌"
    ],
    "muscles": [
      "upper-back"
    ],
    "secondary": [
      "biceps",
      "lower-back",
      "front-deltoids",
      "back-deltoids"
    ],
    "tips": [
      "握距比肩宽，把横杆拉到上胸，肩胛先下沉",
      "别向后仰成 45° 靠体重拉"
    ]
  },
  {
    "id": "Close-Grip_Front_Lat_Pulldown",
    "name": "窄距高位下拉",
    "en": "Close-Grip Front Lat Pulldown",
    "part": "背",
    "equipment": "绳索",
    "level": "入门",
    "primary": [
      "背阔肌"
    ],
    "muscles": [
      "upper-back"
    ],
    "secondary": [
      "biceps",
      "lower-back",
      "front-deltoids",
      "back-deltoids"
    ],
    "tips": [
      "窄握行程更长，拉的时候挺胸",
      "别耸肩，肩要沉下去再发力"
    ]
  },
  {
    "id": "Seated_Cable_Rows",
    "name": "坐姿绳索划船",
    "en": "Seated Cable Rows",
    "part": "背",
    "equipment": "绳索",
    "level": "入门",
    "primary": [
      "中背"
    ],
    "muscles": [
      "upper-back",
      "lower-back"
    ],
    "secondary": [
      "biceps",
      "front-deltoids",
      "back-deltoids"
    ],
    "tips": [
      "坐着把绳索拉向腹部，胸口打开、肩胛后收",
      "腰别一前一后地开合"
    ]
  },
  {
    "id": "Straight-Arm_Pulldown",
    "name": "直臂下压",
    "en": "Straight-Arm Pulldown",
    "part": "背",
    "equipment": "绳索",
    "level": "入门",
    "primary": [
      "背阔肌"
    ],
    "muscles": [
      "upper-back"
    ],
    "secondary": [],
    "tips": [
      "手臂基本伸直，用背把横杆压到大腿前",
      "这是孤立背阔肌的动作，重量不需要大"
    ]
  },
  {
    "id": "Inverted_Row",
    "name": "反向划船",
    "en": "Inverted Row",
    "part": "背",
    "equipment": "自重",
    "level": "入门",
    "primary": [
      "中背"
    ],
    "muscles": [
      "upper-back",
      "lower-back"
    ],
    "secondary": [],
    "tips": [
      "身体越水平越难，用背把胸口拉向横杆",
      "臀部塌下去会让腰代偿"
    ]
  },
  {
    "id": "Barbell_Shrug",
    "name": "杠铃耸肩",
    "en": "Barbell Shrug",
    "part": "背",
    "equipment": "杠铃",
    "level": "入门",
    "primary": [
      "斜方肌"
    ],
    "muscles": [
      "trapezius"
    ],
    "secondary": [],
    "tips": [
      "把肩膀直直往上提，顶端停一下",
      "别转圈，耸肩就是上下"
    ]
  },
  {
    "id": "Hyperextensions_Back_Extensions",
    "name": "山羊挺身",
    "en": "Hyperextensions (Back Extensions)",
    "part": "背",
    "equipment": "双杠/其他",
    "level": "入门",
    "primary": [
      "竖脊肌"
    ],
    "muscles": [
      "lower-back"
    ],
    "secondary": [
      "gluteal",
      "hamstring"
    ],
    "tips": [
      "起身到身体一条直线就停，练的是竖脊肌",
      "超过直线继续往上顶会压腰椎"
    ]
  },
  {
    "id": "Barbell_Squat",
    "name": "杠铃深蹲",
    "en": "Barbell Squat",
    "part": "腿",
    "equipment": "杠铃",
    "level": "入门",
    "primary": [
      "股四头肌"
    ],
    "muscles": [
      "quadriceps"
    ],
    "secondary": [
      "calves",
      "gluteal",
      "hamstring",
      "lower-back"
    ],
    "tips": [
      "脚略比肩宽、脚尖略微外展，蹲到大腿平行或更低",
      "膝内扣和脚跟离地是最常见的两个问题"
    ]
  },
  {
    "id": "Front_Squat_Clean_Grip",
    "name": "前蹲",
    "en": "Front Squat (Clean Grip)",
    "part": "腿",
    "equipment": "杠铃",
    "level": "进阶",
    "primary": [
      "股四头肌"
    ],
    "muscles": [
      "quadriceps"
    ],
    "secondary": [
      "abs",
      "gluteal",
      "hamstring"
    ],
    "tips": [
      "杠铃放在前肩，上身保持直立，对股四头肌刺激更集中",
      "手肘下沉杠铃就会滑下来"
    ]
  },
  {
    "id": "Box_Squat",
    "name": "箱式深蹲",
    "en": "Box Squat",
    "part": "腿",
    "equipment": "杠铃",
    "level": "进阶",
    "primary": [
      "股四头肌"
    ],
    "muscles": [
      "quadriceps"
    ],
    "secondary": [
      "adductor",
      "calves",
      "gluteal",
      "hamstring",
      "lower-back"
    ],
    "tips": [
      "坐到箱子上略停顿再起，能练髋部爆发和固定深度",
      "别重重砸在箱子上卸力"
    ]
  },
  {
    "id": "Barbell_Lunge",
    "name": "杠铃箭步蹲",
    "en": "Barbell Lunge",
    "part": "腿",
    "equipment": "杠铃",
    "level": "进阶",
    "primary": [
      "股四头肌"
    ],
    "muscles": [
      "quadriceps"
    ],
    "secondary": [
      "calves",
      "gluteal",
      "hamstring"
    ],
    "tips": [
      "前腿膝盖对准脚尖，后腿膝盖接近地面",
      "前脚离得太近会让膝盖超出脚尖太多"
    ]
  },
  {
    "id": "Barbell_Walking_Lunge",
    "name": "行走箭步蹲",
    "en": "Barbell Walking Lunge",
    "part": "腿",
    "equipment": "杠铃",
    "level": "入门",
    "primary": [
      "股四头肌"
    ],
    "muscles": [
      "quadriceps"
    ],
    "secondary": [
      "calves",
      "gluteal",
      "hamstring"
    ],
    "tips": [
      "每一步都落地稳定再迈下一步",
      "步子太小就成了原地蹲"
    ]
  },
  {
    "id": "Leg_Press",
    "name": "腿举",
    "en": "Leg Press",
    "part": "腿",
    "equipment": "器械",
    "level": "入门",
    "primary": [
      "股四头肌"
    ],
    "muscles": [
      "quadriceps"
    ],
    "secondary": [
      "calves",
      "gluteal",
      "hamstring"
    ],
    "tips": [
      "脚踩满踏板，下放到膝盖约 90°",
      "别放到腰离开靠垫，那是最危险的姿势"
    ]
  },
  {
    "id": "Leg_Extensions",
    "name": "腿屈伸",
    "en": "Leg Extensions",
    "part": "腿",
    "equipment": "器械",
    "level": "入门",
    "primary": [
      "股四头肌"
    ],
    "muscles": [
      "quadriceps"
    ],
    "secondary": [],
    "tips": [
      "顶端停一秒收紧股四头肌",
      "别用惯性甩，这个动作要慢"
    ]
  },
  {
    "id": "Lying_Leg_Curls",
    "name": "俯卧腿弯举",
    "en": "Lying Leg Curls",
    "part": "腿",
    "equipment": "器械",
    "level": "入门",
    "primary": [
      "腘绳肌"
    ],
    "muscles": [
      "hamstring"
    ],
    "secondary": [],
    "tips": [
      "把脚跟往臀部收，全程贴住垫子",
      "臀部抬起来就是代偿了"
    ]
  },
  {
    "id": "Seated_Leg_Curl",
    "name": "坐姿腿弯举",
    "en": "Seated Leg Curl",
    "part": "腿",
    "equipment": "器械",
    "level": "入门",
    "primary": [
      "腘绳肌"
    ],
    "muscles": [
      "hamstring"
    ],
    "secondary": [],
    "tips": [
      "坐姿让腘绳肌在拉长位发力，效果通常比俯卧更好",
      "别弹震，回程要控制"
    ]
  },
  {
    "id": "Romanian_Deadlift",
    "name": "罗马尼亚硬拉",
    "en": "Romanian Deadlift",
    "part": "腿",
    "equipment": "杠铃",
    "level": "进阶",
    "primary": [
      "腘绳肌"
    ],
    "muscles": [
      "hamstring"
    ],
    "secondary": [
      "calves",
      "gluteal",
      "lower-back"
    ],
    "tips": [
      "膝盖微屈固定，杠铃贴着腿下放，感觉腘绳肌被拉长",
      "弓背或者杠铃离身体太远都会伤腰"
    ]
  },
  {
    "id": "Good_Morning",
    "name": "早安式",
    "en": "Good Morning",
    "part": "腿",
    "equipment": "杠铃",
    "level": "进阶",
    "primary": [
      "腘绳肌"
    ],
    "muscles": [
      "hamstring"
    ],
    "secondary": [
      "abs",
      "gluteal",
      "lower-back"
    ],
    "tips": [
      "杠铃放在上背，靠屈髋把上身降下去",
      "重量一定要小，腰不好就换成器械"
    ]
  },
  {
    "id": "Barbell_Hip_Thrust",
    "name": "杠铃臀推",
    "en": "Barbell Hip Thrust",
    "part": "腿",
    "equipment": "杠铃",
    "level": "进阶",
    "primary": [
      "臀大肌"
    ],
    "muscles": [
      "gluteal"
    ],
    "secondary": [
      "calves",
      "hamstring"
    ],
    "tips": [
      "上背靠凳、杠铃压在髋部，顶端夹紧臀部",
      "别用腰去顶，是臀部把髋推到完全伸展"
    ]
  },
  {
    "id": "Barbell_Glute_Bridge",
    "name": "杠铃臀桥",
    "en": "Barbell Glute Bridge",
    "part": "腿",
    "equipment": "杠铃",
    "level": "进阶",
    "primary": [
      "臀大肌"
    ],
    "muscles": [
      "gluteal"
    ],
    "secondary": [
      "calves",
      "hamstring"
    ],
    "tips": [
      "躺在地上做，行程比臀推短，更适合新手",
      "顶端别过度后仰腰椎"
    ]
  },
  {
    "id": "Standing_Calf_Raises",
    "name": "站姿提踵",
    "en": "Standing Calf Raises",
    "part": "腿",
    "equipment": "器械",
    "level": "入门",
    "primary": [
      "小腿"
    ],
    "muscles": [
      "calves"
    ],
    "secondary": [],
    "tips": [
      "垫着脚尖往上提到最高，停一下再慢慢放",
      "幅度太小等于没练，全程都要走完"
    ]
  },
  {
    "id": "Seated_Calf_Raise",
    "name": "坐姿提踵",
    "en": "Seated Calf Raise",
    "part": "腿",
    "equipment": "器械",
    "level": "入门",
    "primary": [
      "小腿"
    ],
    "muscles": [
      "calves"
    ],
    "secondary": [],
    "tips": [
      "坐姿主要练比目鱼肌，膝盖压住负重",
      "别弹震，慢慢放到底"
    ]
  }
];

/** 有氧项目：器材和户外各占一半，都是能记时长的 */
export const CARDIO_ACTIVITIES: CardioActivity[] = [
  {
    "id": "Running_Treadmill",
    "name": "跑步机",
    "en": "Running, Treadmill",
    "level": "入门",
    "tips": [
      "速度从走开始渐进，坡度 1% 更接近户外",
      "别抓着扶手跑，那个配速和热量都是假的"
    ]
  },
  {
    "id": "Walking_Treadmill",
    "name": "跑步机快走",
    "en": "Walking, Treadmill",
    "level": "入门",
    "tips": [
      "坡道调到 8~12%、速度 4~5 km/h，是很省膝盖的有氧",
      "身体别一直后仰挂在扶手上"
    ]
  },
  {
    "id": "Stairmaster",
    "name": "爬楼机",
    "en": "Stairmaster",
    "level": "进阶",
    "tips": [
      "身体直立、手轻扶，让腿真的承担体重",
      "整个人压在手柄上就没效果了"
    ]
  },
  {
    "id": "Step_Mill",
    "name": "台阶机",
    "en": "Step Mill",
    "level": "进阶",
    "tips": [
      "这是真的在爬楼梯，节奏放稳别跨两级",
      "别低头看脚下，容易失衡"
    ]
  },
  {
    "id": "Elliptical_Trainer",
    "name": "椭圆机",
    "en": "Elliptical Trainer",
    "level": "进阶",
    "tips": [
      "脚踩满踏板，靠阻力而不是速度来加难度",
      "阻力太低光甩腿，等于白练"
    ]
  },
  {
    "id": "Bicycling_Stationary",
    "name": "动感单车",
    "en": "Bicycling, Stationary",
    "level": "入门",
    "tips": [
      "座椅高度调到踩到底时膝盖略弯，阻力调到能说话但微喘",
      "座椅太低最伤膝盖"
    ]
  },
  {
    "id": "Rowing_Stationary",
    "name": "划船机",
    "en": "Rowing, Stationary",
    "level": "进阶",
    "tips": [
      "腿→髋→手臂的顺序发力，回程反过来",
      "用胳膊先拉最常见的错误，容易腰疼"
    ]
  },
  {
    "id": "Rope_Jumping",
    "name": "跳绳",
    "en": "Rope Jumping",
    "level": "进阶",
    "tips": [
      "手腕摇绳、脚尖落地，先练双摇前的基础节奏",
      "跳太高落地太重，很伤膝盖"
    ]
  },
  {
    "id": "Bicycling",
    "name": "户外骑行",
    "en": "Bicycling",
    "level": "入门",
    "tips": [
      "保持踏频 80~90 转/分，比硬踩大齿比更省力",
      "座垫太低骑久了膝盖会疼"
    ]
  },
  {
    "id": "Trail_Running_Walking",
    "name": "户外慢跑",
    "en": "Trail Running/Walking",
    "level": "入门",
    "tips": [
      "能连续说话就是合适的有氧强度",
      "一开始追配速是受伤的主要来源"
    ]
  }
];

export function exercisesOfPart(part: BodyPart): Exercise[] {
  return EXERCISES.filter((e) => e.part === part);
}

export function findExercise(id: string): Exercise | undefined {
  return EXERCISES.find((e) => e.id === id);
}

export function findCardio(id: string): CardioActivity | undefined {
  return CARDIO_ACTIVITIES.find((c) => c.id === id);
}
