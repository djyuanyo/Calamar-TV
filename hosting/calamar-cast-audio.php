<?php

/** Give Chromecast one audio rendition per group when the requested language is present. */
function castAudioManifest($manifest, $language, $label = '') {
    if (!is_string($language) || !preg_match('/^[a-z]{2,3}(?:[-_][a-z0-9]{2,8}){0,2}$/iD', $language)) return $manifest;
    $language = strtolower(str_replace('_', '-', $language));
    $label = is_string($label) && strlen($label) <= 160 ? trim($label) : '';
    $lines = preg_split('/\r?\n/', $manifest);
    $normalize = static function ($code) {
        return preg_replace('/^(spa|esp)(?=-|$)/', 'es', strtolower(str_replace('_', '-', $code)));
    };
    $language = $normalize($language);
    $family = explode('-', $language)[0];
    $groups = [];
    foreach ($lines as $index => $line) {
        if (strpos($line, '#EXT-X-MEDIA:') !== 0) continue;
        preg_match_all('/(?:^|,)([A-Z0-9-]+)=("[^"]*"|[^,]*)/', substr($line, 13), $parts, PREG_SET_ORDER);
        $attrs = [];
        foreach ($parts as $part) $attrs[$part[1]] = trim($part[2], '"');
        if (($attrs['TYPE'] ?? '') !== 'AUDIO' || empty($attrs['GROUP-ID'])) continue;
        $name = $attrs['NAME'] ?? '';
        $lang = $normalize($attrs['LANGUAGE'] ?? '');
        $latin = preg_match('/latino|latam|^es-(?:419|mx|ar|co|us)\b/i', $lang . ' ' . $name);
        $spanish = $family === 'es' && (explode('-', $lang)[0] === 'es' || preg_match('/castellano|espa(?:n|ñ)ol|spanish/iu', $name));
        $score = 0;
        if ($label !== '' && strcasecmp($name, $label) === 0) $score = 5;
        elseif ($lang === $language && !($family === 'es' && $language === 'es' && $latin)) $score = 4;
        elseif ($spanish && !$latin) $score = 3;
        elseif ($lang === $family || strpos($lang, $family . '-') === 0 || $spanish) $score = 2;
        $groups[$attrs['GROUP-ID']][$index] = $score;
    }
    foreach ($groups as $scores) {
        $best = max($scores);
        if ($best === 0) continue;
        $selected = array_search($best, $scores, true);
        foreach ($scores as $index => $score) {
            if ($index !== $selected) unset($lines[$index]);
        }
        $lines[$selected] = preg_replace('/("(?:[^"]*)")|,(?:DEFAULT|AUTOSELECT)=(?:YES|NO)(?=,|$)/',
            '$1', $lines[$selected]) . ',DEFAULT=YES,AUTOSELECT=YES';
    }
    return implode("\n", $lines);
}
