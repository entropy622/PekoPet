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
}
