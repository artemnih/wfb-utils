import { NodeBinding } from '@polus-wfb/common';

export function isDirectory(binding: NodeBinding) {
    return (
        binding.type === 'directory' ||
        binding.type === 'file' ||
        binding.type === 'path' ||
        binding.type === 'collection' ||
        binding.type === 'csvCollection' ||
        binding.name.toLowerCase() === 'inpdir' ||
        binding.name.toLowerCase().endsWith('path') ||
        binding.name.toLowerCase().endsWith('dir')
    );
}
