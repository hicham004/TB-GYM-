using TB.Gym.Modules.CheckIns;
using TB.Gym.Modules.ExerciseLibrary;
using TB.Gym.Modules.Subscriptions;
using TB.Gym.SharedKernel;

namespace TB.Gym.Infrastructure.Initialization;

/// <summary>
/// Who and what the Atlas Performance demo contains. Every person is fictional; days are relative to
/// the day the command runs (0 is today, -7 is a week ago), so the demo always looks current.
/// </summary>
internal static class DemoWorkspaceCast
{
    public const string WorkspaceName = "Atlas Performance";
    public const string TimeZoneId = "Asia/Beirut";
    public const string Currency = "USD";

    /// <summary>The day the owner opens the workspace, before anyone else arrives.</summary>
    public const int WorkspaceCreatedDay = -77;

    public static readonly DemoStaff Owner = new("karim", "Karim", "Haddad", "karim@atlas.example");

    public static readonly IReadOnlyList<DemoStaff> Coaches =
    [
        new("lea", "Lea", "Khoury", "lea@atlas.example"),
        new("omar", "Omar", "Nassar", "omar@atlas.example"),
    ];

    public static readonly IReadOnlyList<DemoProduct> Products =
    [
        new(
            "Online Coaching",
            "Your own program, a weekly check-in and direct chat with your coach.",
            [
                new(DemoOffer.Coaching12Weeks, "12 weeks", 12, 330m),
                new(DemoOffer.Coaching4Weeks, "4 weeks", 4, 130m),
            ],
            [CoachingFeature.Training, CoachingFeature.CheckIns, CoachingFeature.Messaging]),
        new(
            "Strength Program",
            "Powerlifting-style programming with technique feedback on your lifts.",
            [new(DemoOffer.Strength8Weeks, "8 weeks", 8, 180m)],
            [CoachingFeature.Training, CoachingFeature.Messaging]),
    ];

    /// <summary>
    /// Base working loads for a trained adult (strength factor 1). A client's accessory load is this
    /// times their factor, climbing a little every week. Null means bodyweight.
    /// </summary>
    public static readonly IReadOnlyList<DemoExercise> Exercises =
    [
        new("goblet-squat", "Goblet Squat", ExerciseEquipment.Dumbbell, MovementPattern.Squat, ExerciseClassification.Strength,
            [(MuscleGroup.Quadriceps, MuscleRole.Primary), (MuscleGroup.Glutes, MuscleRole.Secondary)],
            ["lower", "beginner friendly"], "Hold the dumbbell at your chest, sit between your heels, keep your chest tall.", [], 24m, 2m),
        new("leg-press", "Leg Press", ExerciseEquipment.Machine, MovementPattern.Squat, ExerciseClassification.Strength,
            [(MuscleGroup.Quadriceps, MuscleRole.Primary), (MuscleGroup.Glutes, MuscleRole.Secondary)],
            ["lower"], "Feet shoulder-width, lower until your knees reach 90 degrees, press through the whole foot.", [], 140m, 5m),
        new("back-squat", "Back Squat", ExerciseEquipment.Barbell, MovementPattern.Squat, ExerciseClassification.Strength,
            [(MuscleGroup.Quadriceps, MuscleRole.Primary), (MuscleGroup.Glutes, MuscleRole.Primary), (MuscleGroup.Adductors, MuscleRole.Secondary)],
            ["main lift", "lower"], "Brace before you unrack, sit down between your hips, drive the floor away.",
            ["goblet-squat", "leg-press"], null, 2.5m),
        new("db-bench-press", "Dumbbell Bench Press", ExerciseEquipment.Dumbbell, MovementPattern.HorizontalPush, ExerciseClassification.Strength,
            [(MuscleGroup.Chest, MuscleRole.Primary), (MuscleGroup.Triceps, MuscleRole.Secondary)],
            ["upper", "push"], "Shoulder blades pinned, lower to mid-chest, press up and slightly in.", [], 26m, 2m),
        new("bench-press", "Bench Press", ExerciseEquipment.Barbell, MovementPattern.HorizontalPush, ExerciseClassification.Strength,
            [(MuscleGroup.Chest, MuscleRole.Primary), (MuscleGroup.Triceps, MuscleRole.Secondary), (MuscleGroup.Shoulders, MuscleRole.Secondary)],
            ["main lift", "upper", "push"], "Feet planted, slight arch, touch the chest and pause before you press.",
            ["db-bench-press"], null, 2.5m),
        new("romanian-deadlift", "Romanian Deadlift", ExerciseEquipment.Barbell, MovementPattern.Hinge, ExerciseClassification.Strength,
            [(MuscleGroup.Hamstrings, MuscleRole.Primary), (MuscleGroup.Glutes, MuscleRole.Secondary)],
            ["lower", "hinge"], "Soft knees, push your hips back until you feel the hamstrings, keep the bar close.", [], 70m, 2.5m),
        new("deadlift", "Deadlift", ExerciseEquipment.Barbell, MovementPattern.Hinge, ExerciseClassification.Strength,
            [(MuscleGroup.Hamstrings, MuscleRole.Primary), (MuscleGroup.Glutes, MuscleRole.Primary), (MuscleGroup.Back, MuscleRole.Secondary)],
            ["main lift", "lower", "hinge"], "Bar over mid-foot, pull the slack out, push the floor away and stand tall.",
            ["romanian-deadlift"], null, 2.5m),
        new("db-shoulder-press", "Seated Dumbbell Shoulder Press", ExerciseEquipment.Dumbbell, MovementPattern.VerticalPush, ExerciseClassification.Strength,
            [(MuscleGroup.Shoulders, MuscleRole.Primary), (MuscleGroup.Triceps, MuscleRole.Secondary)],
            ["upper", "push"], "Back against the pad, press up without shrugging, lower to ear height.", [], 20m, 2m),
        new("overhead-press", "Overhead Press", ExerciseEquipment.Barbell, MovementPattern.VerticalPush, ExerciseClassification.Strength,
            [(MuscleGroup.Shoulders, MuscleRole.Primary), (MuscleGroup.Triceps, MuscleRole.Secondary)],
            ["main lift", "upper", "push"], "Squeeze glutes, press the bar in a straight line, head through at the top.",
            ["db-shoulder-press"], null, 2.5m),
        new("walking-lunge", "Walking Lunge", ExerciseEquipment.Dumbbell, MovementPattern.Squat, ExerciseClassification.Strength,
            [(MuscleGroup.Quadriceps, MuscleRole.Primary), (MuscleGroup.Glutes, MuscleRole.Primary)],
            ["lower", "single leg"], "Long steps, back knee kisses the floor, reps are per leg.", [], 16m, 2m),
        new("split-squat", "Bulgarian Split Squat", ExerciseEquipment.Dumbbell, MovementPattern.Squat, ExerciseClassification.Strength,
            [(MuscleGroup.Quadriceps, MuscleRole.Primary), (MuscleGroup.Glutes, MuscleRole.Primary)],
            ["lower", "single leg"], "Rear foot on the bench, drop straight down, reps are per leg.", ["walking-lunge"], 14m, 2m),
        new("leg-curl", "Seated Leg Curl", ExerciseEquipment.Machine, MovementPattern.Isolation, ExerciseClassification.Strength,
            [(MuscleGroup.Hamstrings, MuscleRole.Primary)],
            ["lower"], "Pull all the way under, pause, and lower for three seconds.", [], 40m, 2.5m),
        new("calf-raise", "Standing Calf Raise", ExerciseEquipment.Machine, MovementPattern.Isolation, ExerciseClassification.Strength,
            [(MuscleGroup.Calves, MuscleRole.Primary)],
            ["lower"], "Full stretch at the bottom, pause at the top.", [], 60m, 5m),
        new("hip-thrust", "Barbell Hip Thrust", ExerciseEquipment.Barbell, MovementPattern.Hinge, ExerciseClassification.Strength,
            [(MuscleGroup.Glutes, MuscleRole.Primary), (MuscleGroup.Hamstrings, MuscleRole.Secondary)],
            ["lower", "glutes"], "Chin tucked, ribs down, stop when your hips are level with your knees.", [], 80m, 2.5m),
        new("incline-db-press", "Incline Dumbbell Press", ExerciseEquipment.Dumbbell, MovementPattern.HorizontalPush, ExerciseClassification.Strength,
            [(MuscleGroup.Chest, MuscleRole.Primary), (MuscleGroup.Shoulders, MuscleRole.Secondary)],
            ["upper", "push"], "Bench at 30 degrees, elbows at 45, press up over the upper chest.", ["db-bench-press"], 22m, 2m),
        new("push-up", "Push-up", ExerciseEquipment.Bodyweight, MovementPattern.HorizontalPush, ExerciseClassification.General,
            [(MuscleGroup.Chest, MuscleRole.Primary), (MuscleGroup.Triceps, MuscleRole.Secondary)],
            ["upper", "push", "no equipment"], "Straight line from head to heels, chest to the floor every rep.", [], null, 0m),
        new("lat-pulldown", "Lat Pulldown", ExerciseEquipment.Cable, MovementPattern.VerticalPull, ExerciseClassification.Strength,
            [(MuscleGroup.Back, MuscleRole.Primary), (MuscleGroup.Biceps, MuscleRole.Secondary)],
            ["upper", "pull"], "Lean back slightly, pull the bar to your upper chest, control it up.", [], 55m, 2.5m),
        new("pull-up", "Pull-up", ExerciseEquipment.Bodyweight, MovementPattern.VerticalPull, ExerciseClassification.Strength,
            [(MuscleGroup.Back, MuscleRole.Primary), (MuscleGroup.Biceps, MuscleRole.Secondary)],
            ["upper", "pull"], "Start from a dead hang, chest to the bar, lower all the way.", ["lat-pulldown"], null, 0m),
        new("seated-row", "Seated Cable Row", ExerciseEquipment.Cable, MovementPattern.HorizontalPull, ExerciseClassification.Strength,
            [(MuscleGroup.Back, MuscleRole.Primary), (MuscleGroup.Biceps, MuscleRole.Secondary)],
            ["upper", "pull"], "Chest up, pull to your belly button, squeeze the shoulder blades.", [], 55m, 2.5m),
        new("db-row", "One-arm Dumbbell Row", ExerciseEquipment.Dumbbell, MovementPattern.HorizontalPull, ExerciseClassification.Strength,
            [(MuscleGroup.Back, MuscleRole.Primary), (MuscleGroup.Biceps, MuscleRole.Secondary)],
            ["upper", "pull"], "Hand and knee on the bench, row to your hip, reps are per arm.", ["seated-row"], 26m, 2m),
        new("lateral-raise", "Lateral Raise", ExerciseEquipment.Dumbbell, MovementPattern.Isolation, ExerciseClassification.Strength,
            [(MuscleGroup.Shoulders, MuscleRole.Primary)],
            ["upper", "shoulders"], "Lead with the elbows, stop at shoulder height, no swinging.", [], 8m, 1m),
        new("face-pull", "Face Pull", ExerciseEquipment.Cable, MovementPattern.HorizontalPull, ExerciseClassification.Strength,
            [(MuscleGroup.Shoulders, MuscleRole.Primary), (MuscleGroup.Back, MuscleRole.Secondary)],
            ["upper", "shoulders", "prehab"], "Rope at eye level, pull apart towards your forehead, thumbs back.", [], 20m, 2.5m),
        new("db-curl", "Dumbbell Curl", ExerciseEquipment.Dumbbell, MovementPattern.Isolation, ExerciseClassification.Strength,
            [(MuscleGroup.Biceps, MuscleRole.Primary)],
            ["upper", "arms"], "Elbows pinned to your sides, squeeze at the top, lower slowly.", [], 12m, 2m),
        new("triceps-pushdown", "Triceps Pushdown", ExerciseEquipment.Cable, MovementPattern.Isolation, ExerciseClassification.Strength,
            [(MuscleGroup.Triceps, MuscleRole.Primary)],
            ["upper", "arms"], "Elbows still, push down until your arms are straight, pause.", [], 25m, 2.5m),
        new("knee-raise", "Hanging Knee Raise", ExerciseEquipment.Bodyweight, MovementPattern.Isolation, ExerciseClassification.Strength,
            [(MuscleGroup.Abdominals, MuscleRole.Primary)],
            ["core"], "Hang still, curl your knees towards your chest, no swinging.", [], null, 0m),
    ];

    /// <summary>The main-lift percentage waves; accessories keep their own sets and rep ranges.</summary>
    private static readonly DemoWeekScheme[] LeanPhaseOne =
    [
        new("Week 1 · Build", 70m, 8, 3, 7m, false),
        new("Week 2 · Build", 72.5m, 8, 3, 7.5m, false),
        new("Week 3 · Build", 75m, 8, 3, 8m, false),
        new("Week 4 · Push", 77.5m, 6, 3, 8m, false),
        new("Week 5 · Push", 80m, 6, 3, 8.5m, false),
        new("Week 6 · Deload", 65m, 6, 2, 6.5m, true),
    ];

    private static readonly DemoWeekScheme[] LeanPhaseTwo =
    [
        new("Week 1 · Strength", 75m, 6, 3, 7.5m, false),
        new("Week 2 · Strength", 77.5m, 6, 3, 8m, false),
        new("Week 3 · Strength", 80m, 5, 3, 8m, false),
        new("Week 4 · Heavy", 82.5m, 5, 3, 8.5m, false),
        new("Week 5 · Heavy", 85m, 3, 3, 8.5m, false),
        new("Week 6 · Deload", 70m, 5, 2, 6.5m, true),
    ];

    private static readonly DemoWeekScheme[] StrengthWave =
    [
        new("Week 1 · Volume", 70m, 8, 3, 7m, false),
        new("Week 2 · Volume", 72.5m, 8, 3, 7.5m, false),
        new("Week 3 · Volume", 75m, 6, 3, 7.5m, false),
        new("Week 4 · Strength", 77.5m, 6, 3, 8m, false),
        new("Week 5 · Strength", 80m, 5, 3, 8m, false),
        new("Week 6 · Strength", 82.5m, 5, 3, 8.5m, false),
        new("Week 7 · Peak", 85m, 3, 3, 9m, false),
        new("Week 8 · Deload", 65m, 5, 2, 6m, true),
    ];

    private static readonly DemoWeekScheme[] ResetWeeks =
    [
        new("Week 1 · Learn", 0m, 0, 0, 0m, false),
        new("Week 2 · Practise", 0m, 0, 0, 0m, false),
        new("Week 3 · Load", 0m, 0, 0, 0m, false),
        new("Week 4 · Consolidate", 0m, 0, 0, 0m, false),
    ];

    public static readonly IReadOnlyList<DemoProgram> Programs =
    [
        new("lean-1", "Lean & Strong · Phase 1",
            "Four days a week. Get stronger on the big lifts while you lose fat.", LeanPhaseOne,
            [
                new("Lower A", 0, "Warm up with two light sets of squats before your first working set.",
                [
                    Main("back-squat"), Acc("romanian-deadlift", 3, 8, 10), Acc("walking-lunge", 3, 10, 12),
                    Acc("leg-curl", 3, 10, 12), Acc("calf-raise", 2, 12, 15),
                ]),
                new("Upper A", 1, "Pause every bench rep on your chest.",
                [
                    Main("bench-press"), Acc("db-row", 3, 8, 10), Acc("db-shoulder-press", 3, 8, 10),
                    Acc("lat-pulldown", 3, 10, 12), Acc("triceps-pushdown", 2, 12, 15),
                ]),
                new("Lower B", 3, "Deadlifts first while you are fresh. Reset every rep.",
                [
                    Main("deadlift"), Acc("split-squat", 3, 8, 10), Acc("hip-thrust", 3, 10, 12),
                    Acc("knee-raise", 3, 10, 15),
                ]),
                new("Upper B", 5, null,
                [
                    Main("overhead-press"), Acc("incline-db-press", 3, 8, 10), Acc("seated-row", 3, 10, 12),
                    Acc("lateral-raise", 3, 12, 15), Acc("db-curl", 2, 10, 12),
                ]),
            ]),
        new("lean-2", "Lean & Strong · Phase 2",
            "Heavier main lifts and fewer reps, same four-day rhythm.", LeanPhaseTwo,
            [
                new("Lower A", 0, "Two warm-up sets, then the working sets. Leave one rep in the tank.",
                [
                    Main("back-squat"), Acc("leg-press", 3, 10, 12), Acc("split-squat", 3, 8, 10),
                    Acc("leg-curl", 3, 10, 12),
                ]),
                new("Upper A", 1, null,
                [
                    Main("bench-press"), Acc("seated-row", 3, 8, 10), Acc("incline-db-press", 3, 8, 10),
                    Acc("face-pull", 3, 12, 15), Acc("db-curl", 2, 10, 12),
                ]),
                new("Lower B", 3, "Film your heaviest deadlift set from the side.",
                [
                    Main("deadlift"), Acc("hip-thrust", 3, 8, 10), Acc("walking-lunge", 3, 10, 12),
                    Acc("calf-raise", 3, 12, 15),
                ]),
                new("Upper B", 5, null,
                [
                    Main("overhead-press"), Acc("lat-pulldown", 3, 8, 10), Acc("db-bench-press", 3, 10, 12),
                    Acc("lateral-raise", 3, 12, 15), Acc("triceps-pushdown", 2, 12, 15),
                ]),
            ]),
        new("strength", "Strength Foundations",
            "Three days a week built around squat, bench and deadlift. The percentages climb every week.", StrengthWave,
            [
                new("Squat day", 0, "Belt on for the last working set only.",
                [
                    Main("back-squat"), Acc("romanian-deadlift", 3, 6, 8), Acc("leg-press", 3, 10, 12),
                    Acc("knee-raise", 3, 10, 15),
                ]),
                new("Bench day", 2, "Competition pause on every rep.",
                [
                    Main("bench-press"), Main("overhead-press"), Acc("seated-row", 3, 8, 10),
                    Acc("face-pull", 3, 12, 15), Acc("triceps-pushdown", 2, 12, 15),
                ]),
                new("Deadlift day", 4, "Conventional stance. Reset every rep.",
                [
                    Main("deadlift"), Acc("split-squat", 3, 8, 10), Acc("pull-up", 3, 6, 8),
                    Acc("db-curl", 2, 10, 12),
                ]),
            ]),
        new("reset", "Full Body Reset",
            "Three full-body sessions a week to rebuild movement, core strength and the habit.", ResetWeeks,
            [
                new("Full body A", 0, "Slow and controlled. Stop two reps before failure.",
                [
                    Acc("goblet-squat", 3, 10, 12), Acc("db-bench-press", 3, 10, 12), Acc("lat-pulldown", 3, 10, 12),
                    Acc("hip-thrust", 3, 10, 12), Acc("knee-raise", 2, 8, 12),
                ]),
                new("Full body B", 2, null,
                [
                    Acc("romanian-deadlift", 3, 10, 12), Acc("push-up", 3, 8, 12), Acc("seated-row", 3, 10, 12),
                    Acc("walking-lunge", 2, 8, 10), Acc("face-pull", 2, 12, 15),
                ]),
                new("Full body C", 4, "Finish with a 10-minute walk.",
                [
                    Acc("leg-press", 3, 10, 12), Acc("incline-db-press", 3, 10, 12), Acc("db-row", 3, 10, 12),
                    Acc("lateral-raise", 2, 12, 15), Acc("db-curl", 2, 10, 12),
                ]),
            ]),
    ];

    public static readonly DemoCheckInForm CheckInForm = new(
        "Weekly check-in",
        "Takes two minutes. Be honest: it is how I adjust your plan.",
        [
            new(CheckInQuestionType.NumericScale, "How was your energy this week?", true, "energy", "1 is exhausted, 10 is unstoppable.", 1m, 10m, 1m),
            new(CheckInQuestionType.NumericScale, "How well did you sleep?", true, "sleep", null, 1m, 10m, 1m),
            new(CheckInQuestionType.NumericScale, "How stressed did you feel?", true, "stress", "1 is calm, 10 is overwhelmed.", 1m, 10m, 1m),
            new(CheckInQuestionType.SingleChoice, "How closely did you follow your plan?", true, "adherence",
                Options: ["All of it", "Most of it", "About half", "Not much this week"]),
            new(CheckInQuestionType.LongText, "What was your biggest win this week?", false, "win"),
            new(CheckInQuestionType.LongText, "Anything else I should know?", false, "notes"),
        ]);

    public static readonly IReadOnlyList<string> CheckInWins =
    [
        "Hit every session this week.",
        "Slept 7 hours or more most nights.",
        "Added weight on my main lift.",
        "Meal-prepped on Sunday and it saved my week.",
        "Walked 10k steps five days out of seven.",
        "More energy at work, no afternoon crash.",
        "No sugar cravings after dinner.",
        "My jeans fit better.",
        "Finally enjoyed leg day.",
    ];

    public static readonly IReadOnlyList<string> CheckInNotes =
    [
        "Busy week at work, stress was high.",
        "Knee felt a bit tight on lunges, nothing sharp.",
        "Travelling for three days next week.",
        "Energy was lower mid-week.",
        "All good, nothing to add!",
        "Can we add a bit more arm work?",
        "Family lunch on Sunday went a bit off plan.",
    ];

    public static readonly IReadOnlyList<string> WorkoutNotes =
    [
        "Felt strong today.",
        "Gym was packed, did the accessories as supersets.",
        "Short on time, rushed the last exercise.",
        "Left knee a bit tight on the last set.",
        "Great pump today.",
    ];

    public static readonly IReadOnlyList<string> CoachWorkoutReplies =
    [
        "Great work. Keep the tempo slow on the way down.",
        "Nice session. Tell me how the knee feels next time.",
        "That's the consistency we want.",
    ];

    public static readonly IReadOnlyList<DemoClient> Clients =
    [
        new("maya", "Maya", "Fakhoury", "lea", 29, 166m, IsHero: true,
            Goals: "Lose 6 kg and feel strong for my wedding in December.",
            WorkType: "Marketing manager, mostly at a desk", Steps: 7000,
            Background: "Pilates twice a week for a year, never lifted weights.",
            FoodPreferences: "Mediterranean food, loves labneh and grilled chicken.", FoodAversions: "Liver, very spicy food.",
            Allergies: null, Medications: null, Injuries: null,
            CoachNotes: "Wedding in mid-December. Loves hip thrusts, hates burpees. Prefers messages in the morning.",
            Plans: [new(DemoOffer.Coaching12Weeks, -63, ManualPaymentMethod.MobileWallet)],
            Blocks: [new("lean-1", -63), new("lean-2", -21)],
            Maxes: new(60m, 32.5m, 75m, 25m), StrengthFactor: 0.55m, SetsPersonalBests: true,
            StartWeight: 68.4m, WeeklyTrend: -0.45m, WeighInRate: 0.85, Waist: 76m, WaistTrend: -0.4m,
            Adherence: 0.95, TrainingHour: 18, TrainingMinute: 30, Mood: new(7, 7, 5),
            Welcome: "Welcome to Atlas, Maya! I've read your intake. We'll get you strong and confident for December. Your first program starts today.",
            Messages:
            [
                new(-63, 21, 10, false, "Thank you!! A bit nervous about the barbell stuff but excited 😅"),
                new(-62, 8, 15, true, "Totally normal. Start light on squats, film one set from the side and send it to me after your session."),
                new(-56, 19, 40, false, "Week 1 done ✅ my legs are destroyed"),
                new(-56, 20, 5, true, "That's the spirit. A 10-minute walk after dinner helps with the soreness."),
                new(-42, 12, 30, false, "Can I move leg day to Wednesday this week? Family lunch on Tuesday 🙈"),
                new(-42, 13, 10, true, "Of course. Just keep a rest day before your next lower session."),
                new(-22, 18, 0, true, "Phase 2 starts tomorrow: heavier squats, fewer reps. You've earned it."),
                new(-21, 21, 30, false, "New squat PR today!! Never thought I'd enjoy leg day"),
                new(-21, 21, 45, true, "Proud of you 👏 Clean reps, too."),
                new(-3, 20, 10, false, "Dress fitting on Saturday… it's already a bit loose 🙈"),
                new(-3, 20, 40, true, "Love that! Keep protein high this week and don't skip your steps."),
                DemoMessage.Recent(TimeSpan.FromMinutes(55), true, "Hi Maya! Lower A today. If last week's squats felt easy, add 2.5 kg on the last set."),
            ]),
        new("rami", "Rami", "Tabet", "karim", 34, 181m,
            Goals: "Squat 180 kg and deadlift 220 kg before the Beirut Classic in March.",
            WorkType: "Civil engineer, on site three days a week", Steps: 9000,
            Background: "Six years of lifting, two local powerlifting meets.",
            FoodPreferences: "Eats everything, big breakfast person.", FoodAversions: null,
            Allergies: null, Medications: null, Injuries: "Tight left hip on deep sumo deadlifts.",
            CoachNotes: "Competing at the Beirut Classic in March. Low-bar squat, conventional deadlift only (hip is tight on sumo).",
            Plans:
            [
                new(DemoOffer.Strength8Weeks, -70, ManualPaymentMethod.BankTransfer),
                new(DemoOffer.Strength8Weeks, -14, ManualPaymentMethod.BankTransfer),
            ],
            Blocks: [new("strength", -70), new("strength", -14)],
            Maxes: new(165m, 115m, 195m, 70m), StrengthFactor: 1.35m, SetsPersonalBests: true,
            StartWeight: 86m, WeeklyTrend: 0.1m, WeighInRate: 0.6, Waist: null, WaistTrend: 0m,
            Adherence: 0.97, TrainingHour: 7, TrainingMinute: 0, Mood: new(8, 7, 4),
            TrainedTodayAgo: TimeSpan.FromHours(2.25),
            Welcome: "Welcome aboard, Rami. Eight weeks of Strength Foundations, then we reassess your maxes. Send me your best squat video from the last month.",
            Messages:
            [
                new(-70, 12, 40, false, "Sent it on WhatsApp. Low bar, belt on the top set. My hip gets tight on deep sumo so I stick to conventional."),
                new(-70, 13, 5, true, "Noted. Conventional only, and we keep squat depth just below parallel."),
                new(-50, 7, 55, false, "Top set felt like an RPE 7, the bar was flying"),
                new(-50, 9, 10, true, "Good sign. Stay on plan: the percentages climb every week."),
                new(-17, 8, 30, true, "Block 1 is done and your estimated squat went up nicely. New training maxes are in your next block."),
                new(-17, 9, 2, false, "Let's go 🔥 renewing for another 8 weeks"),
                new(-4, 7, 50, false, "Deadlifts flew today. The last set was an easy 8."),
                new(-4, 8, 20, true, "Massive. The Beirut Classic is looking very realistic."),
                DemoMessage.Recent(TimeSpan.FromMinutes(80), false, "Squats done. Left knee a bit cranky on the last set, nothing sharp."),
            ]),
        new("nour", "Nour", "Hamdan", "lea", 26, 163m,
            Goals: "Build my glutes and do my first full pull-up.",
            WorkType: "Dentist, on my feet most of the day", Steps: 8500,
            Background: "Gym classes on and off for three years.",
            FoodPreferences: "Vegetarian most days, eats fish.", FoodAversions: "Mushrooms.",
            Allergies: null, Medications: null, Injuries: null,
            CoachNotes: "First pull-up is the big goal. Add band-assisted pull-ups when she's ready.",
            Plans: [new(DemoOffer.Coaching12Weeks, -49, ManualPaymentMethod.MobileWallet)],
            Blocks: [new("lean-1", -49), new("lean-2", -7, UnpublishWeek: 2)],
            Maxes: new(55m, 30m, 70m, 22.5m), StrengthFactor: 0.6m, SetsPersonalBests: true,
            StartWeight: 58m, WeeklyTrend: 0.08m, WeighInRate: 0.7, Waist: null, WaistTrend: 0m,
            Adherence: 0.85, TrainingHour: 17, TrainingMinute: 30, Mood: new(7, 6, 6),
            CheckInWaiting: true,
            Welcome: "Hi Nour! Glutes and a first pull-up: two of my favourite goals. We start today.",
            Messages:
            [
                new(-49, 18, 30, false, "Yay! Do I need to buy anything? Straps, a belt…"),
                new(-49, 18, 55, true, "Nothing for now. Maybe a resistance band later for assisted pull-ups."),
                new(-35, 17, 20, false, "Hip thrusts felt weird in my lower back"),
                new(-35, 17, 45, true, "Tuck your chin and keep your ribs down, and stop when your hips are level with your knees. Send me a clip next time."),
                new(-14, 19, 10, false, "Got 2 slow negatives on the pull-up bar!!"),
                new(-14, 19, 30, true, "Huge! Negatives are exactly how the first full rep happens."),
                new(-8, 12, 0, true, "Phase 2 starts tomorrow. I'm adjusting week 2 after your check-in, it'll be up soon."),
                DemoMessage.Recent(TimeSpan.FromMinutes(160), false, "Is my week up yet? Going to the gym at 6"),
            ]),
        new("jad", "Jad", "Karam", "omar", 31, 183m,
            Goals: "Get down to 85 kg without losing strength.",
            WorkType: "Sales director, travels 1–2 weeks a month", Steps: 6000,
            Background: "Played basketball at uni, lifts on and off since.",
            FoodPreferences: "Eats out a lot for work.", FoodAversions: null,
            Allergies: "Peanuts.", Medications: null, Injuries: null,
            CoachNotes: "Travels to Dubai and Riyadh often. Send him a hotel-gym version before each trip.",
            Plans: [new(DemoOffer.Coaching12Weeks, -56, ManualPaymentMethod.Card)],
            Blocks: [new("lean-1", -56), new("lean-2", -14)],
            Maxes: new(120m, 90m, 150m, 55m), StrengthFactor: 1.1m, SetsPersonalBests: false,
            StartWeight: 94.2m, WeeklyTrend: -0.6m, WeighInRate: 0.55, Waist: 98m, WaistTrend: -0.6m,
            StallFromDay: -14, StallTrend: 0.15m,
            Adherence: 0.8, TrainingHour: 20, TrainingMinute: 0, Mood: new(6, 5, 7),
            MissLastSessions: 3, CheckInOverdue: true,
            Welcome: "Welcome, Jad. 85 kg while keeping your strength is very doable. Your plan starts today.",
            Messages:
            [
                new(-56, 22, 10, false, "Let's do it. I travel a lot for work, is that a problem?"),
                new(-56, 22, 30, true, "No problem. Tell me before a trip and I'll send you a hotel-gym version."),
                new(-30, 20, 45, false, "Down 3.5 kg already 💪"),
                new(-30, 21, 0, true, "Great trend. Keep your steps above 8k."),
                new(-12, 23, 15, false, "Crazy week at work, missed Tuesday"),
                new(-12, 23, 40, true, "It happens. Do Thursday and Saturday, and don't try to make it up."),
                new(-1, 18, 20, true, "Hey Jad, I didn't see you train this week and your check-in is late. Everything OK?"),
            ]),
        new("sara", "Sara", "Mansour", "karim", 38, 168m,
            Goals: "Feel strong again after my second baby.",
            WorkType: "Architect, working part-time from home", Steps: 6500,
            Background: "Ran and did yoga before pregnancy.",
            FoodPreferences: "Home-cooked Lebanese food.", FoodAversions: null,
            Allergies: null, Medications: null, Injuries: "Mild diastasis after pregnancy, cleared by her doctor.",
            CoachNotes: "Seven months postpartum, cleared by her doctor. No heavy crunches. Mornings only, after drop-off.",
            Plans: [new(DemoOffer.Coaching12Weeks, -42, ManualPaymentMethod.Cash)],
            Blocks: [new("reset", -42), new("lean-1", -14)],
            Maxes: new(50m, 30m, 65m, 22.5m), StrengthFactor: 0.5m, SetsPersonalBests: false,
            StartWeight: 71m, WeeklyTrend: -0.3m, WeighInRate: 0.75, Waist: 84m, WaistTrend: -0.5m,
            Adherence: 0.9, TrainingHour: 9, TrainingMinute: 30, Mood: new(6, 4, 6),
            CheckInWaiting: true, SubmitsTodayAgo: TimeSpan.FromMinutes(220),
            Welcome: "Welcome, Sara! We'll start with a 4-week reset to rebuild your core and hips before we load up.",
            Messages:
            [
                new(-42, 21, 30, false, "Thank you. The baby is 7 months, I can train in the mornings after drop-off."),
                new(-42, 21, 50, true, "Perfect. Your sessions fit in 45 minutes."),
                new(-28, 10, 40, false, "First week without back pain in months 🙏"),
                new(-28, 11, 0, true, "That's what we want. The next block adds barbell work."),
                new(-10, 10, 30, false, "Is it OK to train after 4 hours of sleep? Teething week…"),
                new(-10, 10, 50, true, "Do the session but drop one set on each exercise. Recovery first."),
                DemoMessage.Recent(TimeSpan.FromMinutes(215), false, "Sent my check-in. Rough week sleep-wise but I did every session!"),
            ]),
        new("elie", "Elie", "Azar", "omar", 42, 178m,
            Goals: "Lose the belly and stop my lower back from flaring up.",
            WorkType: "Bank branch manager, sits most of the day", Steps: 5000,
            Background: "Nothing regular for ten years.",
            FoodPreferences: "Loves bread and mezze.", FoodAversions: "Oats.",
            Allergies: null, Medications: "Blood pressure medication.", Injuries: "Recurring lower-back pain when sitting long.",
            CoachNotes: "Lower back flares when he sits long. Keep hinges light and progress slowly.",
            Plans:
            [
                new(DemoOffer.Coaching4Weeks, -59, ManualPaymentMethod.Cash),
                new(DemoOffer.Coaching4Weeks, -31, ManualPaymentMethod.Cash),
            ],
            Blocks: [new("reset", -59), new("reset", -31)],
            Maxes: null, StrengthFactor: 0.85m, SetsPersonalBests: false,
            StartWeight: 102m, WeeklyTrend: -0.5m, WeighInRate: 0.6, Waist: 108m, WaistTrend: -0.7m,
            Adherence: 0.85, TrainingHour: 19, TrainingMinute: 0, Mood: new(6, 6, 6),
            AsksToRenewDay: -2,
            Welcome: "Welcome, Elie. We'll ease your back in with a 4-week reset, then build from there.",
            Messages:
            [
                new(-59, 20, 0, false, "Thanks. My lower back is the worry, it flares when I sit for long."),
                new(-59, 20, 20, true, "Stand up every hour at work and do the 5-minute mobility routine. Tell me if anything feels sharp."),
                new(-35, 19, 30, false, "I want another month, my back feels 10× better"),
                new(-35, 19, 45, true, "Love to hear it. Same plan, a bit heavier."),
                new(-8, 20, 15, false, "Down 4 kg since I started!"),
                new(-8, 20, 30, true, "Your belt agrees 😄 Proud of the consistency."),
            ]),
        new("yasmine", "Yasmine", "Chahine", "lea", 33, 170m,
            Goals: "Run a half marathon in March and stay lean.",
            WorkType: "Pharmacist, shifts", Steps: 11000,
            Background: "Runs 30 km a week, new to lifting.",
            FoodPreferences: "High carb on long-run days.", FoodAversions: null,
            Allergies: "Shellfish.", Medications: null, Injuries: "Old right ankle sprain.",
            CoachNotes: "Half marathon in March. Keep lifting at RPE 7 on long-run weeks. Taper the last 10 days.",
            Plans:
            [
                new(DemoOffer.Coaching4Weeks, -50, ManualPaymentMethod.MobileWallet),
                new(DemoOffer.Coaching4Weeks, -22, ManualPaymentMethod.MobileWallet),
            ],
            Blocks: [new("reset", -50), new("reset", -22)],
            Maxes: null, StrengthFactor: 0.55m, SetsPersonalBests: false,
            StartWeight: 61m, WeeklyTrend: -0.15m, WeighInRate: 0.65, Waist: null, WaistTrend: 0m,
            Adherence: 0.88, TrainingHour: 6, TrainingMinute: 30, Mood: new(8, 7, 5),
            Welcome: "Hi Yasmine! Two strength sessions a week will make your running feel easier. We start today.",
            Messages:
            [
                new(-48, 6, 0, false, "Ran 10k yesterday and my legs feel heavy. Still lift today?"),
                new(-48, 6, 12, true, "Yes, just keep everything at an RPE 7 today."),
                new(-23, 19, 0, false, "Renewed! Half marathon registration done 🏃‍♀️"),
                new(-23, 19, 20, true, "Amazing. We'll taper the lifting in the last 10 days before the race."),
                new(-6, 7, 40, false, "Long run 18k, felt strong the whole way"),
                new(-6, 8, 0, true, "Your hips are doing the work now 👏"),
            ]),
        new("hadi", "Hadi", "Srour", "karim", 24, 178m,
            Goals: "Put on 5 kg of muscle.",
            WorkType: "Master's student", Steps: 8000,
            Background: "Two years of home workouts, one year in the gym.",
            FoodPreferences: "Chicken, rice, shawarma.", FoodAversions: "Fish.",
            Allergies: null, Medications: null, Injuries: null,
            CoachNotes: "Forgets to eat lunch at uni. Pushing two packed sandwiches and a laban every day.",
            Plans: [new(DemoOffer.Coaching12Weeks, -73, ManualPaymentMethod.MobileWallet)],
            Blocks: [new("strength", -73), new("reset", -17)],
            Maxes: new(95m, 72.5m, 120m, 47.5m), StrengthFactor: 0.9m, SetsPersonalBests: true,
            StartWeight: 70.5m, WeeklyTrend: 0.25m, WeighInRate: 0.7, Waist: null, WaistTrend: 0m,
            Adherence: 0.9, TrainingHour: 16, TrainingMinute: 0, Mood: new(8, 6, 4),
            Welcome: "Welcome, Hadi! 5 kg of muscle means eating more than feels normal. We'll get there.",
            Messages:
            [
                new(-73, 16, 30, false, "Honestly I forget to eat lunch at uni"),
                new(-73, 16, 50, true, "Pack two sandwiches and a laban. Non-negotiable 😄"),
                new(-45, 15, 40, false, "Up 1.5 kg!"),
                new(-45, 16, 0, true, "Scale and bench both going up. Perfect."),
                new(-5, 17, 10, true, "Your plan ends in two weeks. Want to continue into a muscle-building block?"),
                new(-5, 18, 30, false, "Yes for sure, I'll pay on Friday"),
            ]),
        new("rita", "Rita", "Daher", "lea", 45, 164m,
            Goals: "Strong, pain-free legs for ski season.",
            WorkType: "School principal", Steps: 7500,
            Background: "Skis every winter, tennis in summer.",
            FoodPreferences: "Light dinners.", FoodAversions: null,
            Allergies: null, Medications: null, Injuries: "Both knees ache after long ski days.",
            CoachNotes: "Knees ache after long ski days. Lots of split squats and hamstring work, go easy on jumps.",
            Plans: [new(DemoOffer.Coaching4Weeks, -26, ManualPaymentMethod.BankTransfer)],
            Blocks: [new("reset", -26)],
            Maxes: null, StrengthFactor: 0.55m, SetsPersonalBests: false,
            StartWeight: 64m, WeeklyTrend: -0.1m, WeighInRate: 0.5, Waist: null, WaistTrend: 0m,
            Adherence: 0.9, TrainingHour: 8, TrainingMinute: 0, Mood: new(7, 7, 6),
            CheckInWaiting: true,
            Welcome: "Welcome, Rita! Four weeks to get your legs ready for ski season ⛷️",
            Messages:
            [
                new(-26, 19, 45, false, "Can't wait. My knees are my weak point"),
                new(-26, 20, 5, true, "We'll strengthen around them: lots of split squats and hamstring work."),
                new(-9, 18, 50, false, "The stairs at school no longer kill me"),
                new(-9, 19, 10, true, "That's the ski legs coming 😄"),
            ]),
        new("karl", "Karl", "Matar", "omar", 28, 185m,
            Goals: "Bench 120 kg.",
            WorkType: "Consultant, often in Riyadh", Steps: 7000,
            Background: "Five years of bodybuilding-style training.",
            FoodPreferences: "High protein, eats out a lot.", FoodAversions: null,
            Allergies: null, Medications: null, Injuries: null,
            CoachNotes: "Pause every bench rep. Travels to Riyadh often; pause the plan instead of skipping weeks.",
            Plans: [new(DemoOffer.Strength8Weeks, -40, ManualPaymentMethod.Card)],
            Blocks: [new("strength", -40)],
            Maxes: new(125m, 100m, 150m, 60m), StrengthFactor: 1.2m, SetsPersonalBests: true,
            StartWeight: 81m, WeeklyTrend: 0.15m, WeighInRate: 0.5, Waist: null, WaistTrend: 0m,
            Adherence: 0.75, TrainingHour: 21, TrainingMinute: 0, Mood: new(7, 6, 6),
            PausedDay: -5, PauseReason: "Travelling for work until next week.",
            Welcome: "Welcome, Karl. Bench 120: let's build it. Strength Foundations starts today.",
            Messages:
            [
                new(-40, 21, 30, false, "My best is 105 × 1, a year ago"),
                new(-40, 21, 50, true, "We'll set your training max at 100 and climb from there."),
                new(-20, 22, 0, false, "Bench felt smooth today, the pause reps are getting easier"),
                new(-20, 22, 15, true, "Good. Keep the pause honest on every rep."),
                new(-6, 20, 30, false, "Travelling to Riyadh for work until next week, there's no gym at the hotel"),
                new(-6, 20, 50, true, "No stress. I'll pause your plan so you don't lose any days. Safe trip."),
            ]),
        new("lynn", "Lynn", "Bou Khalil", "karim", 30, 160m,
            Goals: "Lose 4 kg and learn to lift properly.",
            WorkType: "Graphic designer, remote", Steps: 5500,
            Background: "Complete beginner.",
            FoodPreferences: "Snacks a lot while working.", FoodAversions: null,
            Allergies: null, Medications: null, Injuries: null,
            CoachNotes: "Complete beginner. Start on machines to build confidence.",
            Plans: [new(DemoOffer.Coaching12Weeks, -3, ManualPaymentMethod.MobileWallet)],
            Blocks: [],
            Maxes: null, StrengthFactor: 0.45m, SetsPersonalBests: false,
            StartWeight: 66.5m, WeeklyTrend: -0.3m, WeighInRate: 0.95, Waist: null, WaistTrend: 0m,
            Adherence: 0, TrainingHour: 18, TrainingMinute: 0, Mood: new(7, 7, 5),
            Welcome: "Welcome to Atlas, Lynn! I'm building your first program this week. You'll see it here as soon as it's ready.",
            Messages:
            [
                new(-3, 20, 30, false, "Thank you! Should I do some cardio in the meantime?"),
                new(-3, 20, 50, true, "Walks are perfect. Aim for 8,000 steps a day until your program is live."),
                new(-1, 19, 15, false, "9k steps every day so far 🚶‍♀️"),
            ]),
        new("tarek", "Tarek", "Ghanem", "lea", 36, 180m,
            Goals: "Get back to training after knee surgery and lose 5 kg.",
            WorkType: "Restaurant owner, long evenings", Steps: 9000,
            Background: "Played football until his ACL tear in March.",
            FoodPreferences: "Eats late because of work.", FoodAversions: null,
            Allergies: null, Medications: null, Injuries: "Left ACL reconstruction in March. No deep knee bends yet.",
            CoachNotes: "Left ACL reconstruction in March. His physio says no deep knee bends until November.",
            Plans: [new(DemoOffer.Coaching12Weeks, -20, ManualPaymentMethod.Cash)],
            Blocks: [new("reset", -20), new("lean-1", 8, AssignedDay: -2)],
            Maxes: new(90m, 80m, 110m, 50m), StrengthFactor: 0.9m, SetsPersonalBests: false,
            StartWeight: 88m, WeeklyTrend: -0.2m, WeighInRate: 0.6, Waist: null, WaistTrend: 0m,
            Adherence: 0.92, TrainingHour: 11, TrainingMinute: 0, Mood: new(7, 6, 6),
            Welcome: "Welcome, Tarek. We'll respect the knee: four weeks of controlled full-body work first, as your physio asked.",
            Messages:
            [
                new(-20, 19, 0, false, "My physio said no deep knee bends yet"),
                new(-20, 19, 20, true, "Got it. High box squats and leg press to 90 degrees only."),
                new(-7, 18, 40, false, "Leg press felt good today, zero pain"),
                new(-7, 19, 0, true, "Excellent. Your next block is ready and starts right after this one."),
            ]),
    ];

    /// <summary>People invited in the last two days who have not accepted yet.</summary>
    public static readonly IReadOnlyList<DemoPendingInvite> PendingInvites =
    [
        new("karim", "Ziad", "Khalil", "ziad.khalil@mail.example", TimeSpan.FromHours(26)),
        new("lea", "Christelle", "Moukarzel", "christelle.moukarzel@mail.example", TimeSpan.FromHours(5)),
    ];

    public static int IndexOf(DemoClient client) => Clients.ToList().IndexOf(client);

    public static DemoProgram Program(string key) => Programs.Single(program => program.Key == key);

    public static DemoExercise Exercise(string key) => Exercises.Single(exercise => exercise.Key == key);

    public static (DemoProduct Product, DemoOfferInfo Offer) Offer(DemoOffer offer)
    {
        var product = Products.Single(item => item.Offers.Any(candidate => candidate.Offer == offer));
        return (product, product.Offers.Single(item => item.Offer == offer));
    }

    public static DemoStaff Staff(string key) =>
        key == Owner.Key ? Owner : Coaches.Single(coach => coach.Key == key);

    private static DemoExercisePlan Main(string exerciseKey) => new(exerciseKey, 0, 0, 0, IsMainLift: true);

    private static DemoExercisePlan Acc(string exerciseKey, int sets, int repsMinimum, int repsMaximum) =>
        new(exerciseKey, sets, repsMinimum, repsMaximum);
}

internal sealed record DemoStaff(string Key, string FirstName, string LastName, string Email)
{
    public string DisplayName => $"{FirstName} {LastName}";
}

internal enum DemoOffer
{
    Coaching12Weeks,
    Coaching4Weeks,
    Strength8Weeks,
}

internal sealed record DemoProduct(
    string Name,
    string Description,
    IReadOnlyList<DemoOfferInfo> Offers,
    IReadOnlyList<CoachingFeature> Features);

internal sealed record DemoOfferInfo(DemoOffer Offer, string Label, int Weeks, decimal Price);

internal sealed record DemoExercise(
    string Key,
    string Name,
    ExerciseEquipment Equipment,
    MovementPattern Pattern,
    ExerciseClassification Classification,
    IReadOnlyList<(MuscleGroup Muscle, MuscleRole Role)> Muscles,
    IReadOnlyList<string> Tags,
    string Instructions,
    IReadOnlyList<string> AlternativeKeys,
    decimal? BaseLoad,
    decimal LoadStep);

/// <summary>One week of a program's main-lift wave. Deload weeks also drop an accessory set.</summary>
internal sealed record DemoWeekScheme(
    string Label,
    decimal Percent,
    int MainReps,
    int MainSets,
    decimal MainRpe,
    bool IsDeload);

internal sealed record DemoProgram(
    string Key,
    string Name,
    string Description,
    IReadOnlyList<DemoWeekScheme> Weeks,
    IReadOnlyList<DemoSessionPlan> Sessions);

internal sealed record DemoSessionPlan(
    string Name,
    int DayOffset,
    string? CoachNotes,
    IReadOnlyList<DemoExercisePlan> Exercises);

internal sealed record DemoExercisePlan(
    string ExerciseKey,
    int Sets,
    int RepsMinimum,
    int RepsMaximum,
    bool IsMainLift = false);

internal sealed record DemoCheckInForm(string Title, string Description, IReadOnlyList<DemoCheckInQuestion> Questions);

internal sealed record DemoCheckInQuestion(
    CheckInQuestionType Type,
    string Prompt,
    bool IsRequired,
    string Key,
    string? HelpText = null,
    decimal? ScaleMinimum = null,
    decimal? ScaleMaximum = null,
    decimal? ScaleStep = null,
    IReadOnlyList<string>? Options = null);

/// <summary>A plan the client buys. The first starts the relationship; each later one is a renewal.</summary>
internal sealed record DemoPlan(DemoOffer Offer, int StartDay, ManualPaymentMethod Method);

/// <summary>
/// A program block. <paramref name="AssignedDay"/> defaults to two days before it starts.
/// <paramref name="UnpublishWeek"/> is a week the coach holds back to adjust it.
/// </summary>
internal sealed record DemoBlock(string ProgramKey, int StartDay, int? AssignedDay = null, int? UnpublishWeek = null);

/// <summary>Training maxes for the four main lifts in the first block; later blocks start a little higher.</summary>
internal sealed record DemoMaxes(decimal Squat, decimal Bench, decimal Deadlift, decimal OverheadPress);

/// <summary>How a client usually feels, on the check-in's 1–10 scales.</summary>
internal sealed record DemoMood(int Energy, int Sleep, int Stress);

internal sealed record DemoMessage(int Day, int Hour, int Minute, bool FromCoach, string Text)
{
    /// <summary>When set, the message was sent this long before the command ran instead of at Day/Hour/Minute.</summary>
    public TimeSpan? Ago { get; init; }

    public static DemoMessage Recent(TimeSpan ago, bool fromCoach, string text) =>
        new(0, 0, 0, fromCoach, text) { Ago = ago };
}

internal sealed record DemoPendingInvite(string CoachKey, string FirstName, string LastName, string Email, TimeSpan Ago);

internal sealed record DemoClient(
    string Key,
    string FirstName,
    string LastName,
    string CoachKey,
    int Age,
    decimal HeightCentimeters,
    string Goals,
    string WorkType,
    int Steps,
    string Background,
    string FoodPreferences,
    string? FoodAversions,
    string? Allergies,
    string? Medications,
    string? Injuries,
    string CoachNotes,
    IReadOnlyList<DemoPlan> Plans,
    IReadOnlyList<DemoBlock> Blocks,
    DemoMaxes? Maxes,
    decimal StrengthFactor,
    bool SetsPersonalBests,
    decimal StartWeight,
    decimal WeeklyTrend,
    double WeighInRate,
    decimal? Waist,
    decimal WaistTrend,
    double Adherence,
    int TrainingHour,
    int TrainingMinute,
    DemoMood Mood,
    string Welcome,
    IReadOnlyList<DemoMessage> Messages,
    bool IsHero = false,
    int? StallFromDay = null,
    decimal StallTrend = 0m,
    int MissLastSessions = 0,
    TimeSpan? TrainedTodayAgo = null,
    bool CheckInWaiting = false,
    bool CheckInOverdue = false,
    // The latest check-in arrives a day late, this long before the command ran.
    TimeSpan? SubmitsTodayAgo = null,
    int? PausedDay = null,
    string? PauseReason = null,
    int? AsksToRenewDay = null)
{
    public string Email => $"{FirstName}.{LastName.Replace(" ", string.Empty, StringComparison.Ordinal)}@mail.example"
        .ToLowerInvariant();

    public string DisplayName => $"{FirstName} {LastName}";

    /// <summary>The coach invites the client the day before the first plan starts.</summary>
    public int InvitedDay => Plans[0].StartDay - 1;
}
