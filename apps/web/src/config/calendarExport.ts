import type { LanguageCode } from "./profile";

const messages = {
  en: {
    options: "More export options", calendar: "Export to Calendar", preparing: "Preparing calendar...",
    manual: "Download and import the .ics file into your calendar. This is a manual export, not automatic synchronization.",
    result: (events: number, excluded: number) => `${events} ${events === 1 ? "event" : "events"} exported. ${excluded} ${excluded === 1 ? "item" : "items"} excluded because their schedule is missing, unresolved or invalid.`,
    "empty-itinerary": "There is no saved itinerary to export.", "no-events": "No activities have valid start and end times. Review the trip schedule.",
    "invalid-timezone": "The destination timezone is missing or invalid. Review the trip schedule.",
    "ambiguous-time": "A time is ambiguous during a clock change. Save an explicit valid offset before exporting.",
    "nonexistent-time": "A time falls in a daylight-saving gap. Correct the schedule before exporting.",
    "invalid-identity": "An activity could not be identified. Reload the trip and try again.", "too-large": "The itinerary is too large to export as one calendar.",
    "export-failed": "Could not prepare the calendar. Please try again.", "not-found": "This trip or sharing link is unavailable.",
    "unauthorized": "Sign in to export your trip.", "rate-limited": "Too many export requests. Please try again shortly.",
    "invalid-response": "The calendar download could not be completed. Please try again.", "network-error": "Check your connection and try again.",
  },
  pl: {
    options: "Więcej opcji eksportu", calendar: "Export to Calendar", preparing: "Przygotowywanie kalendarza...",
    manual: "Pobierz plik .ics i zaimportuj go do kalendarza. To ręczny eksport, bez automatycznej synchronizacji.",
    result: (events: number, excluded: number) => `Wyeksportowane wydarzenia: ${events}. Pominięte pozycje: ${excluded} — brakujący, nierozstrzygnięty lub nieprawidłowy termin.`,
    "empty-itinerary": "Brak zapisanego planu do eksportu.", "no-events": "Żadna aktywność nie ma prawidłowej godziny rozpoczęcia i zakończenia. Sprawdź plan wycieczki.",
    "invalid-timezone": "Brakuje strefy czasowej celu podróży lub jest ona nieprawidłowa. Sprawdź plan wycieczki.",
    "ambiguous-time": "Godzina jest niejednoznaczna podczas zmiany czasu. Zapisz prawidłowe przesunięcie UTC przed eksportem.",
    "nonexistent-time": "Godzina nie istnieje z powodu zmiany czasu. Popraw termin przed eksportem.",
    "invalid-identity": "Nie można zidentyfikować aktywności. Odśwież wycieczkę i spróbuj ponownie.", "too-large": "Plan jest zbyt duży do eksportu w jednym pliku kalendarza.",
    "export-failed": "Nie udało się przygotować kalendarza. Spróbuj ponownie.", "not-found": "Wycieczka lub link udostępnienia jest niedostępny.",
    "unauthorized": "Zaloguj się, aby wyeksportować wycieczkę.", "rate-limited": "Zbyt wiele prób eksportu. Spróbuj ponownie za chwilę.",
    "invalid-response": "Nie udało się pobrać kalendarza. Spróbuj ponownie.", "network-error": "Sprawdź połączenie i spróbuj ponownie.",
  },
};
export function calendarMessages() {
  let language: LanguageCode = "pl";
  try { if (localStorage.getItem("triply.language") === "en") language = "en"; } catch { /* Match the existing profile preference fallback. */ }
  return messages[language];
}
