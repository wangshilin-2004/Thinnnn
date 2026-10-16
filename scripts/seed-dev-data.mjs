/* 往本地开发库里造一批「看起来像真人用的」数据，用于开发和目视验证。
 *
 * 为什么不用 owner 角色直接用 SQL 灌数据：
 *   那样绕过 RLS，测出来的是「owner 能写」—— 废话，owner 当然能写。
 *   这个脚本刻意用 authenticated 角色 + 伪造的 JWT claims 写入，
 *   于是它顺带验证了三件应用真正依赖的事：
 *     1. authenticated 角色对这些表有 INSERT/UPDATE 的 GRANT
 *     2. 每条 INSERT 都通过了 RLS 的 WITH CHECK
 *     3. 触发器（SECURITY DEFINER）成功替我们写了 daily_summary
 *   跑不过就说明生产环境写入也会失败 —— 这正是我们要的早期信号。
 *
 * 用法：node scripts/seed-dev-data.mjs [--reset]
 */

import postgres from 'postgres';

process.loadEnvFile('.env.development.local');
const USER_ID = process.env.DEV_USER_ID;
if (!USER_ID) {
  console.error('缺少 DEV_USER_ID，先跑 npm run db:dev');
  process.exit(1);
}

const URL_ = process.env.DATABASE_URL;
const sql = postgres(URL_, { prepare: false, onnotice: () => {} });

/** 以某个用户的身份执行 —— 与 src/db/index.ts 的 withUser() 同一套机制。 */
async function asUser(fn) {
  return sql.begin(async (tx) => {
    await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: USER_ID })}, true)`;
    await tx`set local role authenticated`;
    return fn(tx);
  });
}

const day = (offset) => {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
};

/* 伪随机但可复现：用固定种子的线性同余，保证每次跑出来的数据一样。
 * 用 Math.random() 的话，每次「体重涨了」都是新剧情，没法比对截图。 */
let seed = 20261016;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const jitter = (amp) => (rnd() - 0.5) * 2 * amp;

async function main() {
  const reset = process.argv.includes('--reset');

  if (reset) {
    await asUser(async (tx) => {
      await tx`delete from public.meal_items where user_id = ${USER_ID}`;
      await tx`delete from public.measurements where user_id = ${USER_ID}`;
      console.log('已清空该用户的记录');
    });
  }

  /* 1) 档案：套用 buildPlan 的算法（与 src/lib/nutrition.ts 同一套公式，
   *    这里手写数值是为了让脚本不依赖 TS 源码的编译） */
  // 男 / 1999-06-15 / 178cm / 82kg 起始 / 久坐
  // BMR = 10*82 + 6.25*178 - 5*27 + 5 = 820 + 1112.5 - 135 + 5 = 1802.5
  // TDEE = 1802.5 * 1.2 = 2163
  // 缺口 = min(500, 2163*0.2=432.6, 82*0.01*7700/7=902) = 432.6 → 433
  // 目标 = 2163 - 433 = 1730
  const tdee = Math.round(1802.5 * 1.2);
  const deficit = Math.round(Math.min(500, tdee * 0.2, (82 * 0.01 * 7700) / 7));
  const targetKcal = tdee - deficit;
  const targetProtein = Math.round(82 * 1.6);
  const targetFat = Math.round(Math.max(82 * 0.8, (targetKcal * 0.2) / 9));
  const targetCarb = Math.round((targetKcal - targetProtein * 4 - targetFat * 9) / 4);

  await asUser(async (tx) => {
    await tx`
      update public.profiles set
        display_name = '小王',
        sex = 'male',
        birth_date = '1999-06-15',
        height_cm = 178,
        activity_level = 'sedentary',
        goal_type = 'lose',
        start_weight_kg = 82,
        target_weight_kg = 72,
        rate_kg_per_week = 0.5,
        bmr_kcal = 1803,
        tdee_kcal = ${tdee},
        target_kcal = ${targetKcal},
        target_protein_g = ${targetProtein},
        target_carb_g = ${targetCarb},
        target_fat_g = ${targetFat},
        calc_version = 'v1',
        onboarded_at = now()
      where id = ${USER_ID}
    `;
  });
  console.log(
    `档案已更新：TDEE ${tdee} / 目标 ${targetKcal} kcal（缺口 ${deficit}）/ ` +
      `蛋白 ${targetProtein}g 碳水 ${targetCarb}g 脂肪 ${targetFat}g`,
  );

  /* 2) 体重：21 天，带真实感的噪声 —— 每日抖动 ±0.6kg，
   *    但底层趋势是每天 -0.07kg（约 -0.5kg/周，符合设定目标）。
   *    这正是「日线很吵、周线很稳」的场景，用来检验图表有没有把主次画对。 */
  const weightRows = [];
  for (let i = 20; i >= 0; i--) {
    // 前 3 天不记（模拟漏记），其余有 85% 概率记
    if (i > 17) continue;
    if (rnd() > 0.85) continue;
    const base = 82 - (20 - i) * 0.07;
    weightRows.push({ date: day(-i), kg: Math.round((base + jitter(0.6)) * 10) / 10 });
  }

  await asUser(async (tx) => {
    for (const r of weightRows) {
      await tx`
        insert into public.measurements (user_id, metric, measured_on, value, unit, source)
        values (${USER_ID}, 'weight', ${r.date}, ${r.kg}, 'kg', 'manual')
        on conflict (user_id, metric, measured_on)
        do update set value = excluded.value
      `;
    }
  });
  console.log(`体重：写入 ${weightRows.length} 天（最近 ${weightRows[0]?.kg} → ${weightRows.at(-1)?.kg} kg）`);

  /* 3) 饮食：最近 7 天，每天 3-4 餐，从真实食物库里按份量挑。 */
  const foods = await sql`
    select f.id, f.name, f.kcal, f.protein_g, f.fat_g, f.carb_g,
           s.id as serving_id, s.label, s.grams
    from public.foods f
    left join public.food_servings s on s.food_id = f.id and s.is_default
    where f.owner_id is null and f.slug is not null
  `;
  if (foods.length === 0) throw new Error('食物库是空的，先跑 npm run db:seed（或重建库）');

  const pick = (kw) => {
    const hit = foods.find((f) => f.name.includes(kw));
    if (!hit) throw new Error(`食物库里找不到「${kw}」`);
    return hit;
  };

  const breakfast = [pick('白米饭'), pick('鸡蛋（煮）'), pick('纯牛奶'), pick('馒头'), pick('豆浆')];
  const lunch = [pick('白米饭'), pick('鸡胸肉（熟）'), pick('蒜蓉西兰花'), pick('番茄炒蛋'), pick('炒青菜')];
  const dinner = [pick('白米饭'), pick('鲈鱼'), pick('内酯豆腐'), pick('菠菜'), pick('瘦猪肉（熟）')];

  let mealCount = 0;
  let skippedDays = 0;
  let takeoutDays = 0;
  /* 21 天而不是 7 天：趋势页默认看 30 天，只灌 7 天会让整张图三分之二空白，
   * 看不出「趋势」长什么样。21 天刚好让 7 日均值在窗口里真正成型
   * （前 6 天没有均值可画，那是预期行为，不是 bug）。 */
  const daysToLog = 21;
  for (let i = daysToLog - 1; i >= 0; i--) {
    const date = day(-i);

    /* 每 7 天故意漏记 1 天（不含今天）。
     * 目的不是"显得真实"，而是让「漏记的日子留空白」这条渲染路径
     * 在开发数据里真的被走到 —— 全勤数据永远测不到它，也就没人会发现
     * 某天它把相隔多天的两点之间连了一条假直线。 */
    if (i > 0 && i % 7 === 3) {
      skippedDays++;
      continue;
    }

    /* 每 5 天来一个「外卖日」：午餐换成一份外卖，再加一杯奶茶。
     * 这一条是为了让【超过目标】的日子真实存在 ——
     * 目标虚线上方「更亮的柱子」是这份图表唯一的超支编码，
     * 如果开发数据全部低于目标，那条分支根本不会被画出来，
     * 等于写了一个从未被执行过的 if，也就从没被验证过。 */
    const isTakeoutDay = i % 5 === 2;
    if (isTakeoutDay) takeoutDays++;

    const plan = [
      { type: 'breakfast', foods: [breakfast[Math.floor(rnd() * breakfast.length)], breakfast[Math.floor(rnd() * breakfast.length)]] },
      isTakeoutDay
        ? { type: 'lunch', foods: [pick('黄焖鸡米饭')] }
        : { type: 'lunch', foods: [lunch[0], lunch[1 + Math.floor(rnd() * 3)]] },
      { type: 'dinner', foods: [dinner[0], dinner[1 + Math.floor(rnd() * 3)]] },
    ];
    if (isTakeoutDay) {
      plan.push({ type: 'snack', foods: [pick('奶茶')] });
    } else if (rnd() > 0.5) {
      plan.push({ type: 'snack', foods: [pick('无糖酸奶')] });
    }

    await asUser(async (tx) => {
      for (const p of plan) {
        for (const f of p.foods) {
          if (!f) continue;
          // 默认份量存在就用它，否则按 100g
          const grams = f.grams ? Number(f.grams) : 100;
          const factor = grams / 100;
          const kcal = Math.round(Number(f.kcal) * factor * 10) / 10;
          const protein = Math.round(Number(f.protein_g) * factor * 10) / 10;
          const fat = Math.round(Number(f.fat_g) * factor * 10) / 10;
          const carb = Math.round(Number(f.carb_g) * factor * 10) / 10;

          await tx`
            insert into public.meal_items (
              user_id, log_date, meal_type, food_id, food_name,
              quantity_g, serving_id, serving_label,
              kcal, protein_g, fat_g, carb_g
            ) values (
              ${USER_ID}, ${date}, ${p.type}, ${f.id}, ${f.name},
              ${grams}, ${f.serving_id}, ${f.label ?? null},
              ${kcal}, ${protein}, ${fat}, ${carb}
            )
          `;
          mealCount++;
        }
      }
    });
  }
  console.log(
    `饮食：写入 ${mealCount} 条明细，覆盖最近 ${daysToLog} 天` +
      `（故意漏记 ${skippedDays} 天、外卖日 ${takeoutDays} 天）`,
  );

  /* 4) 汇总核对 —— 直接读触发器算出来的结果，确认它真的在干活。
   * 顺带把「超标天数」也打出来：如果它一直是 0，说明上面那个外卖日
   * 没有真的把某天推过目标线，图表里「更亮的柱子」这条编码就没被走到。 */
  const [{ over_days: overDays }] = await sql`
    select count(*) filter (where intake_kcal > target_kcal)::int as over_days
    from public.daily_summary
    where user_id = ${USER_ID} and target_kcal is not null
  `;
  console.log(`超过目标的天数：${overDays} 天${overDays === 0 ? '  ⚠️ 为 0，超支编码没被验证到' : ''}`);

  /* 4) 汇总核对 —— 直接读触发器算出来的结果，确认它真的在干活 */
  const summary = await sql`
    select log_date::text as d, intake_kcal, protein_g, weight_kg, item_count
    from public.daily_summary where user_id = ${USER_ID}
    order by log_date desc limit 7
  `;
  console.log('\n触发器维护的 daily_summary（最近 7 天）：');
  for (const r of summary) {
    console.log(
      `  ${r.d}  摄入 ${String(r.intake_kcal).padStart(6)} kcal  ` +
        `蛋白 ${String(r.protein_g).padStart(5)} g  ` +
        `体重 ${r.weight_kg ?? '—'}  ${r.item_count} 项`,
    );
  }

  await sql.end();
}

main().catch(async (e) => {
  console.error('失败：', e.message);
  if (e.code) console.error('  code =', e.code, ' routine =', e.routine);
  await sql.end().catch(() => {});
  process.exit(1);
});
