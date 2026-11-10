/// Convert a platform UTF-16 offset into a Rust string's byte offset.
pub fn utf16_to_utf8(text: &str, offset: usize) -> usize {
    let mut bytes = 0;
    let mut units = 0;
    for ch in text.chars() {
        if units >= offset {
            break;
        }
        units += ch.len_utf16();
        bytes += ch.len_utf8();
    }
    bytes
}

pub fn composition_selection(
    text: &str,
    start: usize,
    selected: Option<std::ops::Range<usize>>,
) -> std::ops::Range<usize> {
    selected
        .map(|range| {
            start + utf16_to_utf8(text, range.start)..start + utf16_to_utf8(text, range.end)
        })
        .unwrap_or_else(|| start + text.len()..start + text.len())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn chinese_and_surrogate_offsets_stay_on_byte_boundaries() {
        let text = "a你😊好";
        assert_eq!(utf16_to_utf8(text, 2), 4);
        assert_eq!(utf16_to_utf8(text, 4), 8);
        assert_eq!(utf16_to_utf8(text, 50), text.len());
    }
    #[test]
    fn ime_selection_is_relative_to_the_composition_not_the_document() {
        let start = "prefix ".len();
        let document = "prefix 你好 suffix";
        let cursor = start + utf16_to_utf8("你好", 1);
        assert_eq!(&document[..cursor], "prefix 你");
    }
    #[test]
    fn replacing_an_existing_composition_keeps_both_offsets_relative_to_its_start() {
        assert_eq!(composition_selection("你好", 7, Some(0..1)), 7..10);
        assert_eq!(composition_selection("a😊好", 5, Some(1..3)), 6..10);
    }
    #[test]
    fn composition_without_selection_places_the_caret_at_the_new_end() {
        assert_eq!(composition_selection("你好", 7, None), 13..13);
        assert_eq!(composition_selection("", 7, None), 7..7);
    }
}
