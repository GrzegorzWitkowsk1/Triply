import { contentLocale, type ItineraryDay, type SupportedLocale } from "@triply/shared";

/** Server-authored templates only. Interpolated names/user data are never translated. */
export const polishContent: Record<string, string> = {
  "Confirmed: your expenses were updated.": "Potwierdzono: wydatki zostały zaktualizowane.",
  "Confirmed: your itinerary was updated.": "Potwierdzono: plan podróży został zaktualizowany.",
  "Conversation not found": "Nie znaleziono rozmowy",
  "Itinerary days are out of order.": "Dni planu mają nieprawidłową kolejność.",
  "This attraction is scheduled more than once.": "Ta atrakcja została zaplanowana więcej niż raz.",
  "A valid calendar date is needed to verify this day.": "Do sprawdzenia tego dnia potrzebna jest poprawna data.",
  "This day falls outside the trip dates.": "Ten dzień wykracza poza daty podróży.",
  "Destination timezone is unavailable. Timing is uncertain.": "Strefa czasowa celu jest niedostępna. Godziny są niepewne.",
  "Route travel mode is unsupported.": "Wybrany środek transportu nie jest obsługiwany.",
  "This visit has no feasible scheduled time. Adjust or remove it and recalculate.": "Nie udało się wyznaczyć wykonalnego terminu wizyty. Zmień ją lub usuń i przelicz plan.",
  "An unresolved visit must be an attraction without scheduled times.": "Nierozstrzygnięta wizyta musi być atrakcją bez zaplanowanych godzin.",
  "Activity duration must be valid and positive for visits and breaks.": "Czas wizyt i przerw musi być poprawny i dodatni.",
  "Activity times are missing or invalid.": "Godziny aktywności są niepoprawne lub ich brakuje.",
  "Activity duration does not match its scheduled interval.": "Czas aktywności nie odpowiada zaplanowanemu przedziałowi.",
  "Activities overlap. Adjust their times.": "Aktywności nakładają się na siebie. Zmień ich godziny.",
  "Activity timestamps do not belong to this day.": "Godziny aktywności nie należą do tego dnia.",
  "Activity falls outside the daily planning window.": "Aktywność wykracza poza godziny planowanego dnia.",
  "Travel timing is estimated or unavailable. Verify the route.": "Czas przejazdu jest szacunkowy lub niedostępny. Sprawdź trasę.",
  "Attraction coordinates are missing or invalid.": "Współrzędne atrakcji są niepoprawne lub ich brakuje.",
  "This attraction is farther from your destination than your preferred walking distance. Consider transport.": "Ta atrakcja jest dalej od celu niż preferowany dystans pieszy. Rozważ transport.",
  "The full visit does not fit known opening hours.": "Cała wizyta nie mieści się w znanych godzinach otwarcia.",
  "Opening hours cannot be confirmed. Check before visiting.": "Nie można potwierdzić godzin otwarcia. Sprawdź je przed wizytą.",
  "Scheduled activity load exceeds this pace's daily window.": "Zaplanowane aktywności przekraczają dzienny czas dla wybranego tempa.",
  "This day's route exceeds your preferred walking distance.": "Trasa tego dnia przekracza preferowany dystans pieszy.",
  "This day spends more time traveling than visiting attractions.": "W tym dniu przejazdy zajmują więcej czasu niż zwiedzanie.",
  "Travel between these attractions cannot be verified.": "Nie można potwierdzić przejazdu między tymi atrakcjami.",
  "Known planned spending exceeds the trip budget.": "Znane planowane wydatki przekraczają budżet podróży.",
  "Actual spending exceeds the trip budget.": "Rzeczywiste wydatki przekraczają budżet podróży.",
  "Some admission prices are unknown. Spending estimates are incomplete.": "Niektóre ceny wstępu są nieznane. Oszacowanie wydatków jest niepełne.",
  "Budget currencies differ. Totals cannot be directly compared.": "Waluty budżetu różnią się. Nie można bezpośrednio porównać sum.",
  "Budget alignment cannot be evaluated with the available data.": "Dostępne dane nie pozwalają ocenić zgodności z budżetem.",
  "Reserved allocations exceed the trip budget.": "Zarezerwowane kwoty przekraczają budżet podróży.",
  "Known spending exceeds a category allocation.": "Znane wydatki przekraczają kwotę przydzieloną kategorii.",
  "Timing is unresolved after the conflict at {0}; this attraction's availability has not been checked.": "Godziny pozostają nierozstrzygnięte po konflikcie w {0}; dostępność tej atrakcji nie została sprawdzona.",
  "Scheduled across a daylight saving time change.": "Zaplanowano podczas zmiany czasu.",
  "Outdoor activity may be affected: {0}.": "Warunki mogą utrudnić aktywność na zewnątrz: {0}.",
  "Opening hours are not available.": "Godziny otwarcia są niedostępne.",
  "Opening-hours expression exceeds the supported length.": "Zapis godzin otwarcia jest zbyt długi.",
  "Opening-hours source is unverified.": "Źródło godzin otwarcia nie zostało zweryfikowane.",
  "Attraction time zone is unavailable.": "Strefa czasowa atrakcji jest niedostępna.",
  "Visit date or duration is unavailable.": "Data lub czas wizyty są niedostępne.",
  "Regional holiday context is unavailable for these opening hours.": "Brak danych o lokalnych świętach dla tych godzin otwarcia.",
  "Solar opening-hours rules require additional location context.": "Reguły oparte na położeniu słońca wymagają dodatkowych danych lokalizacji.",
  "Visit starts at a nonexistent local time during a daylight saving change.": "Początek wizyty przypada na nieistniejącą godzinę podczas zmiany czasu.",
  "Visit starts at an ambiguous local time during a daylight saving change.": "Początek wizyty przypada na niejednoznaczną godzinę podczas zmiany czasu.",
  "{0} admission cost(s) are unconfirmed. Known spending is a partial estimate.": "Niepotwierdzone koszty wstępu: {0}. Znane wydatki są częściowym oszacowaniem.",
  "Budget comparison unavailable: budget, traveler count or a common currency is missing. Currency totals are shown separately.": "Porównanie budżetu jest niedostępne: brakuje budżetu, liczby podróżnych lub wspólnej waluty. Sumy walut są pokazane oddzielnie.",
  "Known planned spending exceeds your trip budget.": "Znane planowane wydatki przekraczają budżet podróży.",
  "Actual spending exceeds your trip budget.": "Rzeczywiste wydatki przekraczają budżet podróży.",
  "Conditional admission fee": "Warunkowa opłata za wstęp",
  "Free admission": "Wstęp bezpłatny",
  "Paid admission — price unavailable": "Wstęp płatny — cena niedostępna",
  "Admission price unavailable": "Cena wstępu niedostępna",
  "{0} admission{1}": "Wstęp: {0}{1}",
  " per person": " za osobę",
  " per group": " za grupę",
  " (unit unconfirmed)": " (jednostka niepotwierdzona)",
  "open": "otwarte",
  "closed": "zamknięte",
  "unknown": "brak potwierdzenia",
  "unavailable because some data is unconfirmed": "niedostępny, ponieważ część danych jest niepotwierdzona",
  "No blocking conflicts were detected in available data.": "Dostępne dane nie wskazują konfliktów blokujących plan.",
  "Confirmed conflicts need attention.": "Potwierdzone konflikty wymagają uwagi.",
  "Day {0}: ": "Dzień {0}: ",
  "Internal quality indicator: {0}. This does not guarantee real-world feasibility. {1}\n{2}": "Wewnętrzny wskaźnik jakości: {0}. Nie gwarantuje wykonalności w rzeczywistych warunkach. {1}\n{2}",
  "no confirmed prices": "brak potwierdzonych cen",
  "per-person prices{0}": "ceny za osobę{0}",
  " for {0} people": " dla {0} osób",
  ", traveler count unavailable": ", liczba podróżnych nieznana",
  "group prices": "ceny grupowe",
  "unit unconfirmed; not multiplied": "jednostka niepotwierdzona; bez mnożenia",
  "No matching attractions with confirmed pricing information.": "Brak pasujących atrakcji z potwierdzonymi cenami.",
  "{0}: {1}. Source: {2}{3}.": "{0}: {1}. Źródło: {2}{3}.",
  "All scheduled admission fees are accounted for.": "Uwzględniono wszystkie zaplanowane opłaty za wstęp.",
  "This is partial: some prices, admission statuses or pricing units are unknown.": "Dane są częściowe: niektóre ceny, zasady wstępu lub jednostki rozliczenia są nieznane.",
  "{0}\nKnown admission amounts: {1}. {2} Admission costs are separate from the entire trip budget. Prices may change; verify with the attraction.": "{0}\nZnane koszty wstępu: {1}. {2} Koszty wstępu są odrębne od całego budżetu podróży. Ceny mogą się zmienić; sprawdź je u organizatora.",
  "the": "zaplanowanej",
  "a possible": "możliwej",
  " Hours: {0}.": " Godziny: {0}.",
  " Suggested start: {0}.": " Sugerowany początek: {0}.",
  "{0} ({1}, {2}): {3} for {4} {5}-minute visit. {6}{7}{8} Source: {9}.": "{0} ({1}, {2}): {3} dla {4} wizyty trwającej {5} min. {6}{7}{8} Źródło: {9}.",
  "Currency totals": "Sumy według walut",
  "No recorded spending": "Brak zapisanych wydatków",
  "{0}: planned {1}, actual {2}": "{0}: planowane {1}, rzeczywiste {2}",
  "actual": "rzeczywistych",
  "known planned": "znanych planowanych",
  " Most expensive day by {0} spending: day {1}.": " Najdroższy dzień według {0} wydatków: dzień {1}.",
  "Total budget: {0}. Known planned spending: {1}. Actual spending: {2}. Planned remaining: {3}. Actual remaining: {4}.\n{5}: {6}.{7}\n{8}": "Całkowity budżet: {0}. Znane planowane wydatki: {1}. Rzeczywiste wydatki: {2}. Pozostało według planu: {3}. Faktycznie pozostało: {4}.\n{5}: {6}.{7}\n{8}",
  "Review a cheaper alternative for day {0}. Unknown prices remain uncertain.": "Sprawdź tańszą propozycję dnia {0}. Nieznane ceny pozostają niepewne.",
  "Which day should I make cheaper? Please include the day number in your request.": "Który dzień ma być tańszy? Podaj numer dnia w prośbie.",
  "Please specify one currency, amount and title, for example: Record EUR 18 for drinks.": "Podaj jedną walutę, kwotę i tytuł, np.: Record EUR 18 for drinks.",
  "Please request one expense at a time, with a single amount and title.": "Podawaj po jednym wydatku, z jedną kwotą i tytułem.",
  " on day {0}": " w dniu {0}",
  " (unassigned)": " (bez przypisania)",
  "Confirm {0} expense: {1}, {2}{3}.": "Potwierdź wydatek ({0}): {1}, {2}{3}.",
  "Please provide a valid amount, currency and existing day. Add means planned; record means actual.": "Podaj poprawną kwotę, walutę i istniejący dzień. Add oznacza wydatek planowany, a record — rzeczywisty.",
  "Please give the exact expense title. If several expenses share it, edit the desired record in Budget.": "Podaj dokładny tytuł wydatku. Jeśli kilka wydatków ma ten sam tytuł, edytuj właściwy wpis w Budżecie.",
  "Confirm deletion of {0}, {1} ({2}).": "Potwierdź usunięcie: {0}, {1} ({2}).",
  "Which existing day should receive this expense?": "Do którego istniejącego dnia przypisać ten wydatek?",
  "This expense replaces a specific day's admission. Edit its admission association in Budget before moving it.": "Ten wydatek zastępuje wstęp w konkretnym dniu. Przed przeniesieniem zmień powiązanie w Budżecie.",
  "Confirm moving {0} to day {1}. Its recorded date stays unchanged.": "Potwierdź przeniesienie {0} do dnia {1}. Zapisana data pozostanie bez zmian.",
  "Please use Budget to edit expense details, or request: Move the [exact title] expense to day 3.": "Edytuj szczegóły w Budżecie lub poproś: Move the [dokładny tytuł] expense to day 3.",
  "Please specify one expense, for example: Add EUR 25 for lunch on day 2 (planned), or Record EUR 18 for drinks (actual).": "Podaj jeden wydatek, np.: Add EUR 25 for lunch on day 2 (planowany) lub Record EUR 18 for drinks (rzeczywisty).",
  "Lunch break": "Przerwa na obiad",
  "Coffee break": "Przerwa na kawę",
  "Dinner break": "Przerwa na kolację",
  "Return to start": "Powrót do punktu początkowego",
  "To {0}": "Przejście do: {0}",
  "unavailable": "brak danych",
  "none classified": "brak sklasyfikowanych",
  "no attractions": "brak atrakcji",
  " (estimated)": " (szacunkowo)",
  " (uncertain)": " (niepewne)",
  "timezone unknown": "nieznana strefa czasowa",
  "No activities are scheduled.": "Nie zaplanowano żadnych aktywności.",
  "Which attraction do you mean?": "O którą atrakcję chodzi?",
  "{0} scheduled attractions across {1} itinerary day(s).": "Liczba zaplanowanych atrakcji: {0}. Liczba dni planu: {1}.",
  "Route distances are unavailable.": "Odległości tras są niedostępne.",
  "Some days have unavailable distances.": "Dla niektórych dni brakuje danych o odległości.",
  "Day {0} has the longest known route: {1} km{2}. {3} Route distance represents the configured travel mode; it is not necessarily all walking.": "Dzień {0} ma najdłuższą znaną trasę: {1} km{2}. {3} Odległość dotyczy wybranego środka transportu i nie musi oznaczać wyłącznie chodzenia.",
  "Day {0} has the most visiting time: {1} minutes. Travel time: {2} minutes.": "Dzień {0} ma najwięcej czasu na zwiedzanie: {1} min. Czas przejazdów: {2} min.",
  "{0} scheduled minutes including travel and breaks; {1} visiting minutes. Estimated durations are not verified visit times.": "Łącznie zaplanowano {0} min z przejazdami i przerwami, w tym {1} min zwiedzania. Szacunkowe czasy nie są potwierdzonymi czasami wizyt.",
  "Known outdoor attractions: {0}. Unclassified places may also be outdoors.": "Znane atrakcje na świeżym powietrzu: {0}. Niesklasyfikowane miejsca również mogą być na zewnątrz.",
  "{0} is categorized as {1}, with saved score {2}. Your interests are {3}. The planner balances preferences, proximity and schedule fit; a specific selection explanation was not saved.": "{0} ma kategorię {1} i zapisaną ocenę {2}. Twoje zainteresowania: {3}. Plan uwzględnia preferencje, odległości i dostępny czas; szczegółowe uzasadnienie wyboru nie zostało zapisane.",
  "{0}: {1} to {2} (destination local time).": "{0}: od {1} do {2} (czas lokalny miejsca docelowego).",
  "Day {0}{1}: {2}.": "Dzień {0}{1}: {2}.",
  "I can prepare these changes sequentially, with confirmation for each. Which change should we handle first? Please restate that change.": "Mogę przygotować te zmiany kolejno, każdą do potwierdzenia. Którą zmianą zająć się najpierw? Opisz ją ponownie.",
  "I can answer questions about this itinerary and prepare day regeneration or attraction edits. That request is outside those capabilities.": "Mogę odpowiadać na pytania o ten plan, przygotować nową wersję dnia lub zmiany atrakcji. Ta prośba wykracza poza te możliwości.",
  "Please specify the trip question or itinerary change you want.": "Podaj pytanie dotyczące podróży lub opisz zmianę planu.",
  "Which itinerary day do you mean? Available days: {0}.": "O który dzień planu chodzi? Dostępne dni: {0}.",
  "Which attraction do you mean? {0}": "O którą atrakcję chodzi? {0}",
  "How should this day change: less walking, more food, relaxed pace, indoor attractions, or a different plan?": "Jak zmienić ten dzień: mniej chodzenia, więcej jedzenia, spokojniejsze tempo, atrakcje wewnątrz czy inny plan?",
  "Review the proposed day {0}. Your itinerary changes only when you apply the preview.": "Sprawdź propozycję dnia {0}. Plan zmieni się dopiero po zatwierdzeniu podglądu.",
  "Choose an unscheduled attraction using the existing picker, or tell me its exact name.{0}": "Wybierz niezaplanowaną atrakcję z listy lub podaj jej dokładną nazwę.{0}",
  " Matches: {0}.": " Pasujące miejsca: {0}.",
  "Please specify {0}.": "Podaj {0}.",
  "the exact attraction{0}": "dokładną atrakcję{0}",
  "the destination day or attraction to place it before": "docelowy dzień lub atrakcję, przed którą ją umieścić",
  "Move {0} from day {1} to day {2}": "Przenieś {0} z dnia {1} do dnia {2}",
  "Remove {0} from day {1}": "Usuń {0} z dnia {1}",
  "Add {0} to day {1}": "Dodaj {0} do dnia {1}",
  "Replace {0} with {1} on day {2}": "Zastąp {0} przez {1} w dniu {2}",
  "Reorder day {0}: place {1} before {2}": "Zmień kolejność w dniu {0}: umieść {1} przed {2}",
  "{0}. Review the proposed schedule before applying it.": "{0}. Sprawdź proponowany harmonogram przed zatwierdzeniem.",
  "I couldn't prepare a reliable response. Please try again or clarify your request.": "Nie udało się przygotować wiarygodnej odpowiedzi. Spróbuj ponownie lub doprecyzuj prośbę.",
  "{0}\nThis answer is shortened. Ask about a specific day for its full schedule.": "{0}\nOdpowiedź została skrócona. Zapytaj o konkretny dzień, aby zobaczyć pełny harmonogram.",
  "There is no pending attraction selection.": "Nie ma oczekującego wyboru atrakcji.",
  "Some invalid AI suggestions were removed.": "Usunięto nieprawidłowe sugestie AI.",
  "No reliable saved forecast is available. Suggestions use general trip and activity context.": "Brak wiarygodnej zapisanej prognozy. Sugestie opierają się na ogólnych danych podróży i aktywnościach.",
  "Saved forecasts cover some trip days only; weather for other days is unknown.": "Zapisane prognozy obejmują tylko część podróży. Pogoda w pozostałe dni jest nieznana.",
  "Your trip or packing list changed during generation. Review these suggestions carefully.": "Podróż lub lista rzeczy zmieniła się podczas generowania. Sprawdź uważnie sugestie.",
  "Suggestions are per traveler. Review quantities and any seasonal guidance before adding items.": "Sugestie dotyczą jednej osoby. Przed dodaniem rzeczy sprawdź ilości i ewentualne wskazówki sezonowe.",
  "We couldn't interpret your custom instructions, so we used your selected preferences.": "Nie udało się zinterpretować dodatkowych wskazówek, więc użyto wybranych preferencji.",
  "We couldn't find additional places for this request, so the alternative leans on your saved options.": "Nie znaleziono dodatkowych miejsc, więc propozycja opiera się na zapisanych opcjach.",
  "Walking distance couldn't be compared reliably for this alternative.": "Nie można wiarygodnie porównać odległości pieszej dla tej propozycji.",
  "We couldn't find a route meaningfully shorter than the current day.": "Nie znaleziono trasy wyraźnie krótszej od obecnej.",
  "Few reliably indoor options were available around this day, so some stops may be outdoors.": "Dostępnych było niewiele potwierdzonych atrakcji wewnątrz, więc część miejsc może być na zewnątrz.",
  "Known admission estimate change: {0}. Manual expenses are preserved.": "Zmiana szacowanych znanych kosztów wstępu: {0}. Ręcznie dodane wydatki pozostają zachowane.",
  "Date unknown; schedule uses the day index only.": "Data nieznana; harmonogram używa tylko numeru dnia.",
  "Weather forecast unavailable for {0}.": "Prognoza pogody niedostępna na {0}.",
  "Daily time window is invalid; no activities scheduled.": "Nieprawidłowe godziny dnia; nie zaplanowano aktywności.",
  "Coordinates are not usable for scheduling.": "Współrzędne nie nadają się do planowania.",
  "Return travel does not fit within the daily time window.": "Powrót nie mieści się w godzinach zaplanowanego dnia.",
  "Opening hours unverified for {0} attraction(s). Schedule is tentative.": "Niepotwierdzone godziny otwarcia atrakcji: {0}. Harmonogram jest wstępny.",
  "Travel time unavailable; using a configurable fallback estimate.": "Czas przejazdu niedostępny; użyto zastępczego oszacowania.",
  "The attraction does not fit inside the daily time window.": "Atrakcja nie mieści się w godzinach zaplanowanego dnia.",
  "This visit cannot fit within its confirmed opening hours.": "Ta wizyta nie mieści się w potwierdzonych godzinach otwarcia.",
  "The full visit fits within known opening hours.": "Cała wizyta mieści się w znanych godzinach otwarcia.",
  "Opening hours are uncertain for this visit.": "Godziny otwarcia dla tej wizyty są niepewne.",
  "The full visit does not fit within known opening hours.": "Cała wizyta nie mieści się w znanych godzinach otwarcia.",
  "Closed on the selected date.": "Zamknięte w wybranym dniu.",
  "Opening-hours expression could not be evaluated.": "Nie udało się odczytać zapisu godzin otwarcia.",
  "Opening hours are unavailable.": "Godziny otwarcia są niedostępne.",
  "No matching attractions have that confirmed opening-hours status.": "Brak pasujących atrakcji z takim potwierdzonym statusem godzin otwarcia.",
};

export function localized(locale: SupportedLocale = "en") {
  return (parts: TemplateStringsArray | string, ...values: unknown[]): string => {
    const key = typeof parts === "string" ? parts : parts.reduce((s, part, i) => s + (i ? `{${i - 1}}` : "") + part, "");
    const template = contentLocale(locale) === "pl" ? polishContent[key] ?? key : key;
    return template.replace(/\{(\d+)\}/g, (token, i: string) => Number(i) < values.length ? String(values[Number(i)]) : token);
  };
}

// Prefer specific explanations over broad templates such as "{0} admission{1}".
const explanationTemplates = Object.entries(polishContent)
  .filter(([key]) => key.includes("{0}"))
  .sort(([a], [b]) => b.replace(/\{\d+\}/g, "").length - a.replace(/\{\d+\}/g, "").length)
  .map(([key, translation]) => ({ key, translation, pattern: new RegExp(`^${key.split(/\{\d+\}/)
    .map(part => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("([\\s\\S]*?)")}$`) }));

/** Only server-owned explanation fields are passed here; names and addresses are excluded. */
export function localizeExplanation(text: string, locale: SupportedLocale): string {
  if (locale !== "pl") return text;
  if (polishContent[text]) return polishContent[text];
  for (const { key, translation, pattern } of explanationTemplates) {
    const match = pattern.exec(text);
    if (match) {
      if (key === "{0} admission{1}") match[2] = polishContent[match[2]] ?? match[2];
      return translation.replace(/\{(\d+)\}/g, (_, i: string) => match[Number(i) + 1] ?? "");
    }
  }
  return text;
}

/** Apply once to newly built days, never on reads or language changes. */
export function localizeGeneratedDay(day: ItineraryDay, locale: SupportedLocale): ItineraryDay {
  if (locale !== "pl") return day;
  const explain = (text: string) => localizeExplanation(text, locale);
  return { ...day, warnings: day.warnings.map(explain), activities: day.activities.map(activity => ({
    ...activity,
    title: activity.type === "attraction" ? activity.title : explain(activity.title),
    ...(activity.warnings ? { warnings: activity.warnings.map(explain) } : {}),
    ...(activity.openingHoursCheck ? { openingHoursCheck: { ...activity.openingHoursCheck,
      reason: explain(activity.openingHoursCheck.reason), warnings: activity.openingHoursCheck.warnings.map(explain) } } : {}),
  })) };
}

export function assistantResponseLocale(message: string, fallback: SupportedLocale): SupportedLocale {
  if (/\b(?:respond|reply|answer|write)\s+(?:to me\s+)?in\s+(?:English|angielsku)\b|\b(?:odpowiedz|odpowiadaj|pisz)\s+po\s+angielsku\b/i.test(message)) return "en";
  if (/\b(?:respond|reply|answer|write)\s+(?:to me\s+)?in\s+Polish\b|\b(?:odpowiedz|odpowiadaj|pisz)\s+po\s+polsku\b/i.test(message)) return "pl";
  return contentLocale(fallback);
}
